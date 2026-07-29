/**
 * Заглушка Telegraf, повторяющая его семантику маршрутизации: обработчики
 * вызываются В ПОРЯДКЕ РЕГИСТРАЦИИ, `use` пропускает апдейт дальше только
 * через `next()`, а первый подошедший конкретный обработчик апдейт забирает.
 *
 * Нужна для сквозного теста: он проходит через НАСТОЯЩИЙ пайплайн композера —
 * гейт доступа, визард, кнопки, — а не через отдельно взятый обработчик.
 * Подменять сам telegraf приходится потому, что иначе тест требовал бы сети.
 */

type TAny = Record<string, any>;
type THandler = (ctx: TAny, next?: () => Promise<void>) => Promise<unknown> | unknown;

interface IRoute {
  kind: 'use' | 'start' | 'hears' | 'command' | 'on' | 'action';
  trigger?: unknown;
  handler: THandler;
}

export interface IFakeBot {
  use(handler: THandler): unknown;
  start(handler: THandler): unknown;
  hears(trigger: string | RegExp, handler: THandler): unknown;
  command(name: string, handler: THandler): unknown;
  on(event: string, handler: THandler): unknown;
  action(trigger: string | RegExp, handler: THandler): unknown;
  catch(handler: unknown): unknown;
  telegram: TAny;
  botInfo: TAny;
}

export interface ISentMessage {
  chatId: string | number;
  text: string;
  extra?: TAny;
}

export function createFakeBot(botId = 999) {
  const routes: IRoute[] = [];
  /** Всё, что бот отправил: и ответы в чат, и сообщения по chatId. */
  const sent: ISentMessage[] = [];
  const documents: Array<{ chatId: string | number; filename?: string }> = [];
  const alerts: string[] = [];

  const telegram = {
    setMyCommands: async () => undefined,
    getMe: async () => ({ id: botId }),
    sendMessage: async (chatId: string | number, text: string, extra?: TAny) => {
      sent.push({ chatId, text, extra });
      return { chat: { id: chatId }, message_id: sent.length };
    },
    sendDocument: async (chatId: string | number, doc: TAny) => {
      documents.push({ chatId, filename: doc?.filename });
      return { chat: { id: chatId }, message_id: sent.length };
    },
    editMessageText: async () => undefined,
  };

  const bot: IFakeBot = {
    use: (handler) => (routes.push({ kind: 'use', handler }), bot),
    start: (handler) => (routes.push({ kind: 'start', handler }), bot),
    hears: (trigger, handler) => (routes.push({ kind: 'hears', trigger, handler }), bot),
    command: (name, handler) => (routes.push({ kind: 'command', trigger: name, handler }), bot),
    on: (event, handler) => (routes.push({ kind: 'on', trigger: event, handler }), bot),
    action: (trigger, handler) => (routes.push({ kind: 'action', trigger, handler }), bot),
    catch: () => bot,
    telegram,
    botInfo: { id: botId },
  };

  /** Контекст апдейта: собирает ответы туда же, куда и прямые отправки. */
  function makeCtx(update: {
    from: TAny;
    chatId?: number;
    text?: string;
    callbackData?: string;
  }): TAny {
    const chatId = update.chatId ?? update.from.id;

    return {
      from: update.from,
      chat: { id: chatId, type: 'private' },
      botInfo: { id: botId },
      message: update.text === undefined ? undefined : { text: update.text, message_id: 1 },
      callbackQuery:
        update.callbackData === undefined
          ? undefined
          : { data: update.callbackData, message: { message_id: 1 } },
      telegram,
      reply: async (text: string, extra?: TAny) => {
        sent.push({ chatId, text, extra });
        return { message_id: sent.length };
      },
      replyWithDocument: async (doc: TAny) => {
        documents.push({ chatId, filename: doc?.filename });
        return { message_id: sent.length };
      },
      answerCbQuery: async (text?: string) => {
        if (text) alerts.push(text);
      },
      editMessageText: async (text: string) => {
        sent.push({ chatId, text });
      },
    };
  }

  function suits(route: IRoute, ctx: TAny): boolean {
    switch (route.kind) {
      case 'start':
        return typeof ctx.message?.text === 'string' && /^\/start\b/.test(ctx.message.text);
      case 'hears':
        return ctx.message?.text === route.trigger;
      case 'command':
        return ctx.message?.text === `/${route.trigger}`;
      case 'action':
        return (
          ctx.callbackQuery?.data !== undefined &&
          (route.trigger as RegExp).test(ctx.callbackQuery.data)
        );
      case 'on':
        if (route.trigger === 'text') return typeof ctx.message?.text === 'string';
        if (route.trigger === 'callback_query') return ctx.callbackQuery !== undefined;
        return false;
      default:
        return false;
    }
  }

  /** Прогнать один апдейт через пайплайн. */
  async function dispatch(update: Parameters<typeof makeCtx>[0]): Promise<TAny> {
    const ctx = makeCtx(update);
    let index = 0;

    const next = async (): Promise<void> => {
      while (index < routes.length) {
        const route = routes[index];
        index += 1;

        if (route.kind === 'use') {
          await route.handler(ctx, next);
          return;
        }

        if (suits(route, ctx)) {
          // Конкретный обработчик забирает апдейт и дальше не пускает —
          // именно так ведёт себя telegraf.
          await route.handler(ctx);
          return;
        }
      }
    };

    await next();
    return ctx;
  }

  return {
    bot,
    dispatch,
    sent,
    documents,
    alerts,
    /** Тексты, отправленные конкретному получателю. */
    textsTo(chatId: string | number): string[] {
      return sent.filter((m) => String(m.chatId) === String(chatId)).map((m) => m.text);
    },
    lastTextTo(chatId: string | number): string {
      return this.textsTo(chatId).at(-1) ?? '';
    },
  };
}
