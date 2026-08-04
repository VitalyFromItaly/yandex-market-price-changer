import type { TFeatureMap } from '../shared/features.domain';

import { Injectable } from '@nestjs/common';
import { Markup } from 'telegraf';

import { TelegramKeyboard } from '../../ui/keyboard.ui.telegram';
import { allFeaturesEnabled, featureMenuLayout } from '../shared/features.domain';

import { unconfiguredMenuLayout, withAdminRow, withSwitchStore } from './menu.constants';

@Injectable()
export class PriceChangerKeyboard extends TelegramKeyboard {
  /** Сокращённое меню: только настройки и помощь, пока креды не заполнены. */
  public async createUnconfiguredKeyboard(isAdmin = false): Promise<Markup.Markup<any>> {
    const layout = unconfiguredMenuLayout();
    return await this.createKeyboard(isAdmin ? withAdminRow(layout) : layout);
  }

  /**
   * Меню с рядом администратора и без кнопок закрытых возможностей.
   *
   * `features` необязателен: там, где записи доступа под рукой нет, раскладка
   * собирается по умолчанию из реестра. Полагаться на одну лишь раскладку
   * нельзя — подпись кнопки можно прислать текстом, а старая inline-кнопка
   * живёт в истории чата вечно; за это отвечает FeatureGateHandler.
   *
   * `placementType` — модель активного магазина: FBY-only кнопки («🏬 Склады»,
   * «📦 FBY») попадают в раскладку только на FBY-магазине.
   *
   * Администратору фичевый фильтр НЕ применяется: `featureGate` его и так
   * пропускает, а записи `UserAccess` (и значит явных флагов) у него нет —
   * прятать кнопку, которую бот ему разрешает, значит рассинхронизировать
   * раскладку с гейтом. Фильтр по модели магазина действует и для него:
   * FBY-экраны без FBY-магазина пусты у кого угодно.
   */
  public async createMenuKeyboard(
    isAdmin = false,
    features?: TFeatureMap,
    showSwitchStore = false,
    placementType?: string,
  ): Promise<Markup.Markup<any>> {
    // Подписи берутся из menu.constants — единственного источника (TASK-014).
    const effectiveFeatures = isAdmin ? allFeaturesEnabled() : features;
    const base = featureMenuLayout(effectiveFeatures, placementType);
    // Кнопка смены магазина — в ряд к «Прибыли», наверх (см. withSwitchStore), и
    // только когда токен открывает больше одного магазина (флаг считает хендлер
    // из кэша `stores`, без похода в API).
    const layout = showSwitchStore ? withSwitchStore(base) : base;
    return await this.createKeyboard(isAdmin ? withAdminRow(layout) : layout);
  }

  /**
   * Главное меню С УЧЁТОМ подключённого магазина.
   *
   * Без магазина кнопки отчётов бессмысленны: каждая ответит «сначала подключите
   * магазин». Поэтому несконфигуренному пользователю (в т.ч. администратору без
   * своего магазина) отдаём сокращённую раскладку — настройки и помощь, а
   * администратору ещё и ряд «Пользователи». С магазином — полное меню по фичам.
   *
   * Единственный источник этой развилки: `/start`, кнопка «Главное меню», /menu
   * и inline-возврат в меню зовут ОДИН метод, иначе раскладка в них разъедется —
   * та же беда, ради которой существует menu.constants.
   */
  public async buildMainKeyboard(
    configured: boolean,
    isAdmin = false,
    features?: TFeatureMap,
    showSwitchStore = false,
    placementType?: string,
  ): Promise<Markup.Markup<any>> {
    return configured
      ? await this.createMenuKeyboard(isAdmin, features, showSwitchStore, placementType)
      : await this.createUnconfiguredKeyboard(isAdmin);
  }

  public async createStartKeyboard(commands: string[][] = []): Promise<Markup.Markup<any>> {
    // Раньше здесь добавлялись строка «Установить коэффициент цены» и строка
    // с ПУСТОЙ подписью [''] — последнюю Telegram отвергает как некорректную
    // кнопку. Убраны обе.
    return await this.createKeyboard(commands);
  }
}
