import type { ICrmSettingsView } from './crm-settings.domain';
import type { TSettingsWriteResult } from '../../yandex/settings/store-settings.service';

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';

import { FEATURE, isFeatureOpen } from '../../telegram/bots/shared/features.domain';
import { StoreSettingsService } from '../../yandex/settings/store-settings.service';
import { RequireFeature } from '../crm-auth.decorators';
import { CrmJwtGuard, IRequestWithCrmUser } from '../crm-jwt.guard';

import {
  INVALID_SETTING,
  NO_STORE,
  NO_STORE_TEXT,
  parseProfitSettingsBody,
  parsePromoBody,
  toCrmSettingsView,
} from './crm-settings.domain';

/**
 * «Настройки» CRM: ставки, скидки по брендам, продвижение. Полный адрес —
 * /api/crm/ym/settings.
 *
 * Раздел не гейтится: закрыть его значит запереть продавца снаружи его же
 * настроек (довод бота). `promotion` закрывает только свой блок: GET
 * отвечает `promotion: null`, маршруты записи — 403 из гварда.
 *
 * Запись идёт через `StoreSettingsService`, тот же, что у бота, поэтому правка
 * в одном канале сразу видна в другом.
 */
@Controller('crm/ym/settings')
@UseGuards(CrmJwtGuard)
export class CrmSettingsController {
  constructor(private readonly settings: StoreSettingsService) {}

  @Get()
  async view(@Req() request: IRequestWithCrmUser): Promise<ICrmSettingsView> {
    return await this.viewOf(request);
  }

  /** Форма шлёт только изменённые поля: нетронутый бренд не становится «явным решением». */
  @Put()
  async save(
    @Req() request: IRequestWithCrmUser,
    @Body() body: unknown,
  ): Promise<ICrmSettingsView> {
    const result = await this.settings.setProfitSettings(
      request.crmUser.telegramUserId,
      parseProfitSettingsBody(body),
    );
    this.assertWritten(result);
    return await this.viewOf(request);
  }

  @Put('promotion/:brand')
  @RequireFeature(FEATURE.PROMOTION)
  async savePromotion(
    @Req() request: IRequestWithCrmUser,
    @Param('brand') brand: string,
    @Body() body: unknown,
  ): Promise<ICrmSettingsView> {
    const result = await this.settings.setPromotion(
      request.crmUser.telegramUserId,
      brand,
      parsePromoBody(body),
    );
    this.assertWritten(result);
    return await this.viewOf(request);
  }

  @Delete('promotion/:brand')
  @RequireFeature(FEATURE.PROMOTION)
  async disablePromotion(
    @Req() request: IRequestWithCrmUser,
    @Param('brand') brand: string,
  ): Promise<ICrmSettingsView> {
    const result = await this.settings.setPromotion(request.crmUser.telegramUserId, brand, null);
    this.assertWritten(result);
    return await this.viewOf(request);
  }

  private async viewOf(request: IRequestWithCrmUser): Promise<ICrmSettingsView> {
    const user = request.crmUser;
    const settings = await this.settings.settingsOf(user.telegramUserId);
    if (!settings) throw this.noStore();

    return toCrmSettingsView(settings, isFeatureOpen(user.features, FEATURE.PROMOTION));
  }

  private assertWritten(result: TSettingsWriteResult): void {
    if (result.ok === true) return;
    if (result.reason === 'no-store') throw this.noStore();

    throw new BadRequestException({
      statusCode: 400,
      code: INVALID_SETTING,
      field: result.field,
      message: result.error,
    });
  }

  private noStore(): ConflictException {
    return new ConflictException({ statusCode: 409, code: NO_STORE, message: NO_STORE_TEXT });
  }
}
