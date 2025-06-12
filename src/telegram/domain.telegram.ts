import { Context, Markup, Telegraf } from 'telegraf';
import { Update } from 'telegraf/types';
import http from 'http';
import { SceneContextScene, WizardContextWizard, WizardSessionData } from 'telegraf/scenes';
import { KeyboardBuilder } from './bots/shared/KeyboardBuilder';

export type THandleUpdatePayload = Update;
export type TWebHookResponse = http.ServerResponse;

export enum EBotType {
  DEFAULT_BOT_TYPE = 'default_bot_type',
}

export enum EBotName {
  BOT_INSTANCE_NAME = 'bot_instance_name',
}

export interface ITelegramBot<NotifyPayload = any> {
  get id(): string;

  boot(): void;
  launch(): Promise<void>;
  notifySubscribers(payload: NotifyPayload): void;
  handleUpdate(payload: THandleUpdatePayload, webhookResponse?: TWebHookResponse): Promise<void>;
}

export interface ITelegramBotWithScenes {
  createScenes(): void;
}

export interface ITelegramBotService {
  sendMessage(chatId: number, message: string): void;
}

export interface ITelegramKeyboard extends ITelegramCustomKeyboard {
  builder: KeyboardBuilder;

  createInlineButton(text: string, callback_data: string): Promise<Markup.Markup<any>>;
  createInlineButtons(buttons: { text: string; callback_data: string }[]): Promise<Markup.Markup<any>>;
  createKeyboard(keyboard: string[][]): Promise<Markup.Markup<any>>;
}

export interface ITelegramCustomKeyboard {
  createStartKeyboard(context?: Context): Promise<Markup.Markup<any>>;
}

export type TFindBotPayload = {
  type: string;
  id: string;
};

export type TTelegrafBot = Telegraf<Context<any>>;
// @ts-ignore
export type TSceneWizardContext = Context<Update> & { scene: SceneContextScene<any, WizardSessionData>;   wizard: WizardContextWizard<any>; };

export interface IMessageSorter<Item = any> {
  sort: (items: Item[]) => Item[];
}

export const createSubscriptionModel = (botName: EBotName) => {
  throw new Error(`method to be defined`); // TODO: implement the function
  // delete if not needed
  // switch (botName) {
  //   case EBotName.BOT_INSTANCE_NAME:
  //     return UserPumpDumpSubscriptionModel;
  //   case EBotName.LIQUIDATION:
  //     return LiquidationSubscriptionModel;
  //   default:
  //     return null;
  // }
}
