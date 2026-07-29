import type http from 'http';
import type { Context, Markup, Telegraf } from 'telegraf';
import type { SceneContextScene, WizardContextWizard, WizardSessionData } from 'telegraf/scenes';
import type { Update } from 'telegraf/types';

export type THandleUpdatePayload = Update;
export type TWebHookResponse = http.ServerResponse;

export enum EBotType {
  PRICE_CHANGER_BOT = 'price_changer_bot',
}

export enum EBotName {
  PRICE_CHANGER_BOT = 'PriceChangerBot',
}

/**
 * @deprecated Описывал контракт классов-ботов из ручного графа `new`
 * (BaseTelegramBot / PriceChangerBot), которые удалены в TASK-011.
 * Их место занял BotRegistry — см. bots/bot-registry.service.ts.
 */
export interface ITelegramBot {
  get id(): string;

  boot(): void;
  launch(): Promise<void>;
  handleUpdate(payload: THandleUpdatePayload, webhookResponse?: TWebHookResponse): Promise<void>;
}

export interface ITelegramBotWithScenes {
  createScenes(): void;
}

export interface ITelegramBotService {
  sendMessage(chatId: number, message: string): void;
}

export type TTelegramKeyboard = Markup.Markup<any>;

export interface ITelegramKeyboard extends ITelegramCustomKeyboard {
  createInlineButton(text: string, callback_data: string): Promise<TTelegramKeyboard>;
  createInlineButtons(
    buttons: { text: string; callback_data: string }[],
  ): Promise<TTelegramKeyboard>;
  createInlineKeyboardMatrix(
    buttons: { text: string; callback_data: string }[][],
  ): Promise<TTelegramKeyboard>;
  createKeyboard(keyboard: string[] | string[][]): Promise<TTelegramKeyboard>;

  // Новые методы для меню
  createMainMenu?(): Promise<TTelegramKeyboard>;
  createConfirmationMenu?(): Promise<TTelegramKeyboard>;
  createBackMenu?(): Promise<TTelegramKeyboard>;
}

export interface ITelegramCustomKeyboard {
  createStartKeyboard(keyboard?: string[] | string[][]): Promise<Markup.Markup<any>>;
  createMenuKeyboard(): Promise<Markup.Markup<any>>;
}

export type TFindBotPayload = {
  type?: EBotType;
  name?: string;
  id: string;
};

export type TTelegrafBot = Telegraf<Context<any>>;
// Директива @ts-ignore, стоявшая здесь, ничего не подавляла: tsc сообщает,
// что подавлять нечего. Убрана как мёртвая.
export type TSceneWizardContext = Context<Update> & {
  scene: SceneContextScene<any, WizardSessionData>;
  wizard: WizardContextWizard<any>;
};

export interface IMessageSorter<Item = any> {
  sort: (items: Item[]) => Item[];
}
