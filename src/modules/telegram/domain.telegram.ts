import { Context, Markup, Telegraf } from 'telegraf';
import { Update } from 'telegraf/types';
import http from 'http';
import { SceneContextScene, WizardContextWizard, WizardSessionData } from 'telegraf/scenes';
import { KeyboardBuilder } from './bots/shared/KeyboardBuilder';
import PriceChangerBot from './bots/price-changer-bot/price-changer.bot';

export type THandleUpdatePayload = Update;
export type TWebHookResponse = http.ServerResponse;

export enum EBotType {
  PRICE_CHANGER_BOT = 'price_changer_bot',
}

export enum EBotName {
  PRICE_CHANGER_BOT = 'PriceChangerBot',
}

export interface ITelegramBot {
  get id(): string;

  boot(): void;
  launch(): Promise<void>;
  // notifySubscribers(payload: NotifyPayload): void;
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
  createInlineButtons(buttons: { text: string; callback_data: string }[]): Promise<TTelegramKeyboard>;
  createInlineKeyboardMatrix(buttons: { text: string; callback_data: string }[][]): Promise<TTelegramKeyboard>;
  createKeyboard(keyboard: string[] | string[][]): Promise<TTelegramKeyboard>;

  // Новые методы для меню
  createMainMenu?(): Promise<TTelegramKeyboard>;
  createConfirmationMenu?(): Promise<TTelegramKeyboard>;
  createBackMenu?(): Promise<TTelegramKeyboard>;
  createSubscriptionPlansMenu?(): Promise<TTelegramKeyboard>;
}

export interface ITelegramCustomKeyboard {
  createStartKeyboard(keyboard?: string[] | string[][]): Promise<Markup.Markup<any>>;
  createMenuKeyboard(): Promise<Markup.Markup<any>>;
}

export type TFindBotPayload = {
  type?: string;
  name?: string;
  id: string;
};

export type TTelegrafBot = Telegraf<Context<any>>;
// @ts-ignore
export type TSceneWizardContext = Context<Update> & { scene: SceneContextScene<any, WizardSessionData>;   wizard: WizardContextWizard<any>; };

export interface IMessageSorter<Item = any> {
  sort: (items: Item[]) => Item[];
}
