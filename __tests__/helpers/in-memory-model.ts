/**
 * Модель Mongoose в памяти — ровно в том объёме, который используют сервисы:
 * findOne / find / findOneAndUpdate (с $set, $setOnInsert, $unset и upsert) /
 * create / insertMany / updateOne / updateMany / deleteOne / deleteMany /
 * countDocuments / bulkWrite, сортировка в findOne и find (плюс skip/limit),
 * операторы $in, $or и $and в фильтре, плюс `new Model(doc).save()`.
 *
 * Зачем не mongodb-memory-server и не живая Mongo: сквозной тест должен идти
 * из `npm test` на любой машине, без Docker и без сети. Настоящая база здесь
 * ничего не проверяет — предмет теста в том, КТО и В КАКОМ ПОРЯДКЕ ходит за
 * данными, а не в диалекте запросов.
 */

type TDoc = Record<string, any>;

function matches(doc: TDoc, filter: TDoc): boolean {
  return Object.entries(filter ?? {}).every(([field, expected]) => {
    // Поиск товара (`ProductService.search`): каждое слово — `$and`, поля слова — `$or`.
    if (field === '$or') return (expected as TDoc[]).some((part) => matches(doc, part));
    if (field === '$and') return (expected as TDoc[]).every((part) => matches(doc, part));

    // Точечный путь (`marketplaceSkus.ym`) читается по вложенности, как в Mongo.
    const actual = readPath(doc, field);

    // Регэксп в фильтре — так ищется ник без учёта регистра (findByLogin).
    if (expected instanceof RegExp) return typeof actual === 'string' && expected.test(actual);

    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      if ('$lte' in expected) return actual != null && actual <= expected.$lte;
      if ('$gte' in expected) return actual != null && actual >= expected.$gte;
      if ('$ne' in expected) return actual !== expected.$ne;
      // Закуп читается одним запросом по списку артикулов.
      if ('$in' in expected) return (expected.$in as unknown[]).includes(actual);
    }

    // `{field: null}` в Mongo находит и null, и отсутствующее поле — так
    // финансовый журнал ищет неснятые операции (`supersededAt: null`).
    if (expected === null) return actual == null;

    return actual === expected;
  });
}

/** Значение по точечному пути; `undefined`, если по дороге нет объекта. */
function readPath(doc: TDoc, path: string): any {
  let cursor: any = doc;
  for (const part of path.split('.')) {
    if (cursor == null || typeof cursor !== 'object') return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

/**
 * Присвоение полей из update.
 *
 * Mongo трактует поля БЕЗ оператора как `$set` — так пишет, например,
 * `updateByTelegramUser` (`{...data, updated_at}` без `$set`). Пока помощник
 * применял только `$set`, такая правка молча не сохранялась, и тест на изменение
 * ставки показывал старое значение при успешном ответе бота.
 */
function applySet(doc: TDoc, update: TDoc): void {
  for (const [path, value] of Object.entries(update.$set ?? {})) {
    assign(doc, path, value);
  }

  for (const [path, value] of Object.entries(update ?? {})) {
    if (path.startsWith('$')) continue;
    assign(doc, path, value);
  }
}

/** Поддерживаются точечные пути вида `draft.token` — их пишет saveDraftField. */
function assign(doc: TDoc, path: string, value: unknown): void {
  const parts = path.split('.');
  let cursor = doc;
  for (const part of parts.slice(0, -1)) {
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {};
    cursor = cursor[part];
  }
  cursor[parts[parts.length - 1]] = value;
}

function unset(doc: TDoc, path: string): void {
  const parts = path.split('.');
  let cursor = doc;
  for (const part of parts.slice(0, -1)) {
    if (!cursor[part]) return;
    cursor = cursor[part];
  }
  delete cursor[parts[parts.length - 1]];
}

/** Одна операция bulkWrite. Поддерживается только updateOne с upsert. */
interface IBulkOperation {
  updateOne: { filter: TDoc; update: TDoc; upsert?: boolean };
}

export interface IInMemoryModel {
  new (doc?: TDoc): { save(): Promise<TDoc> };
  documents: TDoc[];
  create(doc: TDoc): Promise<TDoc>;
  /** Уникальные поля: попытка записать дубль отвечает ошибкой с code 11000. */
  uniqueBy(...fields: string[]): void;
  findOne(filter: TDoc): {
    sort(spec: Record<string, 1 | -1>): { exec(): Promise<TDoc | null> };
    exec(): Promise<TDoc | null>;
  };
  find(filter?: TDoc): { exec(): Promise<TDoc[]> };
  insertMany(docs: TDoc[]): Promise<TDoc[]>;
  updateMany(
    filter: TDoc,
    update: TDoc,
  ): { exec(): Promise<{ matchedCount: number; modifiedCount: number }> };
  countDocuments(filter?: TDoc): { exec(): Promise<number> };
  bulkWrite(operations: IBulkOperation[]): Promise<{ upsertedCount: number; matchedCount: number }>;
  findOneAndUpdate(
    filter: TDoc,
    update: TDoc,
    options?: { upsert?: boolean; new?: boolean },
  ): { exec(): Promise<TDoc | null> };
  updateOne(filter: TDoc, update: TDoc): { exec(): Promise<{ acknowledged: true }> };
  deleteOne(filter: TDoc): { exec(): Promise<{ deletedCount: number }> };
  deleteMany(filter: TDoc): { exec(): Promise<{ deletedCount: number }> };
}

export function inMemoryModel(seed: TDoc[] = []): IInMemoryModel {
  const documents: TDoc[] = [...seed];
  const unique: string[][] = [];

  class Model {
    constructor(doc: TDoc = {}) {
      Object.assign(this, doc);
    }

    async save(): Promise<TDoc> {
      const plain = { ...(this as unknown as TDoc), createdAt: new Date() };
      documents.push(plain);
      return plain;
    }

    static documents = documents;

    /**
     * Model.create — им пишет ActionLogService. Пока метода не было, запись
     * журнала в сквозном тесте падала внутрь catch внутри record() и тест
     * «проходил», ничего не проверив.
     */
    static async create(doc: TDoc): Promise<TDoc> {
      for (const fields of unique) {
        const filter = Object.fromEntries(fields.map((f) => [f, doc[f]]));
        if (documents.some((d) => matches(d, filter))) {
          // Форма ошибки та же, что у Mongo: сервисы различают дубль по code.
          throw Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
        }
      }

      const plain = { ...doc, _id: String(documents.length + 1), createdAt: new Date() };
      documents.push(plain);
      return plain;
    }

    /** Объявить уникальный индекс — иначе create дублей не замечает. */
    static uniqueBy(...fields: string[]): void {
      unique.push(fields);
    }

    static findOne(filter: TDoc) {
      const found = () => documents.filter((d) => matches(d, filter));
      // Проекция — только исключения (`-field`): ими сервис прячет тяжёлые поля
      // (входной файл задачи CRM), и тест должен видеть, что их правда нет.
      let excluded: string[] = [];
      const project = (doc: TDoc | undefined): TDoc | null => {
        if (!doc) return null;
        if (!excluded.length) return doc;
        const copy = { ...doc };
        for (const field of excluded) delete copy[field];
        return copy;
      };

      const chain = {
        select(spec: string) {
          excluded = spec
            .split(/\s+/)
            .filter((part) => part.startsWith('-'))
            .map((part) => part.slice(1));
          return chain;
        },
        // lean — no-op: документы в памяти и так простые объекты.
        lean: () => chain,
        exec: async () => project(found()[0]),
        /** Только по одному полю — больше сервисам и не нужно. */
        sort(spec: Record<string, 1 | -1>) {
          const [field, direction] = Object.entries(spec)[0] ?? [];
          return {
            exec: async () => {
              const sorted = [...found()].sort((a, b) => {
                const left = a[field] ?? 0;
                const right = b[field] ?? 0;
                if (left === right) return 0;
                return (left < right ? -1 : 1) * (direction === -1 ? -1 : 1);
              });
              return sorted[0] ?? null;
            },
          };
        },
      };
      return chain;
    }

    static find(filter: TDoc = {}) {
      // select/lean — no-op'ы: проекция здесь экономила бы память, которой в
      // тесте нет, а вернуть больше полей безопасно — сервис берёт нужные.
      let order: [string, 1 | -1] | undefined;
      let from = 0;
      let count = Infinity;
      const chain = {
        select: () => chain,
        lean: () => chain,
        /** Только по одному полю, как в findOne. */
        sort(spec: Record<string, 1 | -1>) {
          order = Object.entries(spec)[0];
          return chain;
        },
        skip(n: number) {
          from = n;
          return chain;
        },
        limit(n: number) {
          count = n;
          return chain;
        },
        exec: async () => {
          const found = documents.filter((d) => matches(d, filter));
          if (order) {
            const [field, direction] = order;
            found.sort((a, b) => {
              const left = a[field] ?? 0;
              const right = b[field] ?? 0;
              if (left === right) return 0;
              return (left < right ? -1 : 1) * (direction === -1 ? -1 : 1);
            });
          }
          return found.slice(from, from + count);
        },
      };
      return chain;
    }

    static async insertMany(docs: TDoc[]): Promise<TDoc[]> {
      const created: TDoc[] = [];
      for (const doc of docs) created.push(await Model.create(doc));
      return created;
    }

    static updateMany(filter: TDoc, update: TDoc) {
      return {
        exec: async () => {
          const found = documents.filter((d) => matches(d, filter));
          for (const doc of found) {
            for (const [path, value] of Object.entries(update.$set ?? {})) {
              assign(doc, path, value);
            }
            for (const path of Object.keys(update.$unset ?? {})) unset(doc, path);
          }
          return { matchedCount: found.length, modifiedCount: found.length };
        },
      };
    }

    static countDocuments(filter: TDoc = {}) {
      return { exec: async () => documents.filter((d) => matches(d, filter)).length };
    }

    /**
     * Пакетная запись. Прайс — это тысячи строк, и сервис пишет их одним
     * bulkWrite; последовательные upsert'ы держали бы обработчик минуты.
     */
    static async bulkWrite(operations: IBulkOperation[]) {
      let created = 0;
      let matched = 0;

      for (const operation of operations) {
        const { filter, update, upsert } = operation.updateOne;
        let doc = documents.find((d) => matches(d, filter));

        if (!doc) {
          if (!upsert) continue;
          // $setOnInsert — только при вставке: финансовый журнал пишет им
          // неизменяемые поля операции, и повтор не должен их перетирать.
          // `_id` — как у create: по нему ссылаются на документ (история
          // себестоимости хранит id товара).
          doc = {
            ...stripOperators(filter),
            _id: String(documents.length + 1),
            createdAt: new Date(),
          };
          // Через assign, а не спредом: путь `marketplaceSkus.ym` в Mongo — это
          // вложенное поле, а спред завёл бы буквальный ключ с точкой.
          for (const [path, value] of Object.entries(update.$setOnInsert ?? {})) {
            assign(doc, path, value);
          }
          documents.push(doc);
          created += 1;
        } else {
          matched += 1;
        }

        for (const [path, value] of Object.entries(update.$set ?? {})) {
          assign(doc, path, value);
        }
        for (const path of Object.keys(update.$unset ?? {})) unset(doc, path);
        // timestamps: true — mongoose обновляет updatedAt сам; отчёт печатает
        // именно эту дату, поэтому в памяти её тоже надо ставить.
        doc.updatedAt = new Date();
      }

      return { upsertedCount: created, matchedCount: matched };
    }

    static findOneAndUpdate(filter: TDoc, update: TDoc, options: { upsert?: boolean } = {}) {
      return {
        exec: async () => {
          let doc = documents.find((d) => matches(d, filter));

          if (!doc) {
            if (!options.upsert) return null;
            // При upsert Mongo берёт поля из фильтра как основу документа —
            // без этого запись доступа завелась бы без telegramUserId.
            doc = { ...stripOperators(filter), ...(update.$setOnInsert ?? {}) };
            documents.push(doc);
          }

          applySet(doc, update);
          for (const path of Object.keys(update.$unset ?? {})) unset(doc, path);

          return doc;
        },
      };
    }

    static updateOne(filter: TDoc, update: TDoc) {
      return {
        exec: async () => {
          const doc = documents.find((d) => matches(d, filter));
          if (doc) {
            for (const [path, value] of Object.entries(update.$set ?? {})) {
              assign(doc, path, value);
            }
            for (const path of Object.keys(update.$unset ?? {})) unset(doc, path);
          }
          return { acknowledged: true as const };
        },
      };
    }

    static deleteOne(filter: TDoc) {
      return {
        exec: async () => {
          const index = documents.findIndex((d) => matches(d, filter));
          if (index < 0) return { deletedCount: 0 };
          documents.splice(index, 1);
          return { deletedCount: 1 };
        },
      };
    }

    static deleteMany(filter: TDoc) {
      return {
        exec: async () => {
          const kept = documents.filter((d) => !matches(d, filter));
          const deletedCount = documents.length - kept.length;
          documents.length = 0;
          documents.push(...kept);
          return { deletedCount };
        },
      };
    }
  }

  return Model as unknown as IInMemoryModel;
}

/** Операторы сравнения из фильтра в новый документ переносить нельзя. */
function stripOperators(filter: TDoc): TDoc {
  return Object.fromEntries(
    Object.entries(filter ?? {}).filter(
      ([, value]) => !(value && typeof value === 'object' && !(value instanceof Date)),
    ),
  );
}
