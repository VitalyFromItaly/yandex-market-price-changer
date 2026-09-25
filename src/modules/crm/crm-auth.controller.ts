import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { AllowPendingPasswordChange } from './crm-auth.decorators';
import { CrmAuthService, ICrmMe, ICrmSession } from './crm-auth.service';
import { CrmJwtGuard, IRequestWithCrmUser } from './crm-jwt.guard';

interface ILoginDto {
  login?: string;
  password?: string;
}

interface IPasswordDto {
  current?: string;
  next?: string;
}

/** Полный адрес — /api/crm/auth/... (глобальный префикс задан в main.ts). */
@Controller('crm/auth')
export class CrmAuthController {
  constructor(private readonly auth: CrmAuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Req() request: IRequestWithCrmUser, @Body() body: ILoginDto): Promise<ICrmSession> {
    const login = body.login?.toString().trim();
    const password = body.password?.toString();

    if (!login || !password) {
      throw new BadRequestException('Нужны логин (ник или Telegram id) и пароль');
    }

    const { session, telegramUserId } = await this.auth.loginAs(login, password);
    // Для журнала: токена в этом запросе ещё нет, а строка входа должна
    // находиться фильтром по продавцу.
    request.crmLoginId = telegramUserId;
    return session;
  }

  @Get('me')
  @UseGuards(CrmJwtGuard)
  @AllowPendingPasswordChange()
  async me(@Req() request: IRequestWithCrmUser): Promise<ICrmMe> {
    return await this.auth.me(request.crmUser);
  }

  @Post('password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CrmJwtGuard)
  @AllowPendingPasswordChange()
  async password(
    @Req() request: IRequestWithCrmUser,
    @Body() body: IPasswordDto,
  ): Promise<ICrmSession> {
    const current = body.current?.toString();
    const next = body.next?.toString();

    if (!current || !next) throw new BadRequestException('Нужны текущий и новый пароль');

    return await this.auth.changePassword(request.crmUser.telegramUserId, current, next);
  }
}
