/**
 * Модель Mongoose в памяти — ровно в том объёме, который используют сервисы:
 * findOne / find / findOneAndUpdate (с $set, $setOnInsert, $unset и upsert) /
 * updateOne / deleteOne, плюс `new Model(doc).save()`.
 *
 * Зачем не mongodb-memory-server и не живая Mongo: сквозной тест должен идти
 * из `npm test` на любой машине, без Docker и без сети. Настоящая база здесь
 * ничего не проверяет — предмет теста в том, КТО и В КАКОМ ПОРЯДКЕ ходит за
 * данными, а не в диалекте запросов.
 */

type TDoc = Record<string, any>;

function matches(doc: TDoc, filter: TDoc): boolean {
  return Object.entries(filter ?? {}).every(([field, expected]) => {
    const actual = doc[field];

    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      if ('$lte' in expected) return actual != null && actual <= expected.$lte;
      if ('$gte' in expected) return actual != null && actual >= expected.$gte;
      if ('$ne' in expected) return actual !== expected.$ne;
    }

    return actual === expected;
  });
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

export interface IInMemoryModel {
  new (doc?: TDoc): { save(): Promise<TDoc> };
  documents: TDoc[];
  findOne(filter: TDoc): { exec(): Promise<TDoc | null> };
  find(filter?: TDoc): { exec(): Promise<TDoc[]> };
  findOneAndUpdate(
    filter: TDoc,
    update: TDoc,
    options?: { upsert?: boolean; new?: boolean },
  ): { exec(): Promise<TDoc | null> };
  updateOne(filter: TDoc, update: TDoc): { exec(): Promise<{ acknowledged: true }> };
  deleteOne(filter: TDoc): { exec(): Promise<{ deletedCount: number }> };
}

export function inMemoryModel(seed: TDoc[] = []): IInMemoryModel {
  const documents: TDoc[] = [...seed];

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

    static findOne(filter: TDoc) {
      return { exec: async () => documents.find((d) => matches(d, filter)) ?? null };
    }

    static find(filter: TDoc = {}) {
      return { exec: async () => documents.filter((d) => matches(d, filter)) };
    }

    static findOneAndUpdate(
      filter: TDoc,
      update: TDoc,
      options: { upsert?: boolean } = {},
    ) {
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

          for (const [path, value] of Object.entries(update.$set ?? {})) {
            assign(doc, path, value);
          }
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
  }

  return Model as unknown as IInMemoryModel;
}

/** Операторы сравнения из фильтра в новый документ переносить нельзя. */
function stripOperators(filter: TDoc): TDoc {
  return Object.fromEntries(
    Object.entries(filter ?? {}).filter(
      ([, value]) =>
        !(value && typeof value === 'object' && !(value instanceof Date)),
    ),
  );
}
