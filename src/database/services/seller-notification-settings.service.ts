import type {
  INotificationRuleSetting,
  TNotificationRule,
  TNotificationRuleSettings,
} from '../../modules/notifications/notifications.domain';

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { mergeRuleSettings } from '../../modules/notifications/notifications.domain';
import { DEFAULT_SCHEDULE_TIME } from '../../modules/yandex/reports/schedule-time';
import {
  SellerNotificationSettings,
  SellerNotificationSettingsDocument,
} from '../schemas/seller-notification-settings.schema';

/** Настройки уведомлений продавца с умолчаниями поверх сохранённого. */
export interface ISellerNotificationSettings {
  telegram: boolean;
  time: string;
  rules: TNotificationRuleSettings;
}

/** Что можно поменять одним запросом; значения уже проверены вызывающим. */
export interface ISellerNotificationSettingsPatch {
  telegram?: boolean;
  time?: string;
  rules?: Partial<Record<TNotificationRule, Partial<INotificationRuleSetting>>>;
}

/** Настройки уведомлений (TASK-152). Все запросы — по telegramUserId продавца. */
@Injectable()
export class SellerNotificationSettingsService {
  constructor(
    @InjectModel(SellerNotificationSettings.name)
    private readonly model: Model<SellerNotificationSettingsDocument>,
  ) {}

  async get(telegramUserId: string): Promise<ISellerNotificationSettings> {
    const doc = await this.model.findOne({ telegramUserId }).lean().exec();
    return {
      telegram: doc?.telegram ?? true,
      time: doc?.time ?? DEFAULT_SCHEDULE_TIME,
      rules: mergeRuleSettings(doc?.rules),
    };
  }

  /** Время всех продавцов, у кого есть документ, — для сверки расписания одним запросом. */
  async timesFor(telegramUserIds: readonly string[]): Promise<Map<string, string>> {
    if (!telegramUserIds.length) return new Map();
    const docs = await this.model
      .find({ telegramUserId: { $in: [...telegramUserIds] } })
      .lean()
      .exec();
    return new Map(docs.map((doc) => [doc.telegramUserId, doc.time ?? DEFAULT_SCHEDULE_TIME]));
  }

  async update(
    telegramUserId: string,
    patch: ISellerNotificationSettingsPatch,
  ): Promise<ISellerNotificationSettings> {
    const $set: Record<string, unknown> = {};
    if (patch.telegram !== undefined) $set.telegram = patch.telegram;
    if (patch.time !== undefined) $set.time = patch.time;
    for (const [rule, row] of Object.entries(patch.rules ?? {})) {
      if (row.enabled !== undefined) $set[`rules.${rule}.enabled`] = row.enabled;
      if (row.threshold !== undefined) $set[`rules.${rule}.threshold`] = row.threshold;
    }
    if (Object.keys($set).length) {
      await this.model
        .findOneAndUpdate(
          { telegramUserId },
          { $set, $setOnInsert: { telegramUserId } },
          { upsert: true, new: true },
        )
        .exec();
    }
    return await this.get(telegramUserId);
  }
}
