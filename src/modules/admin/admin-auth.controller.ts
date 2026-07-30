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

import { AdminAuthService } from './admin-auth.service';
import { AdminJwtGuard, IRequestWithAdmin } from './admin-jwt.guard';

interface ILoginDto {
  login?: string;
  password?: string;
}

/** Полный адрес — /api/auth/... (глобальный префикс задан в main.ts). */
@Controller('auth')
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  // Nest на POST по умолчанию отвечает 201 Created, а вход ничего не создаёт.
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: ILoginDto): Promise<{ token: string }> {
    // Валидация руками: class-validator в проекте не используется, а ради двух
    // строковых полей заводить ValidationPipe с декораторами незачем.
    const login = body.login?.toString().trim();
    const password = body.password?.toString();

    if (!login || !password) {
      throw new BadRequestException('Нужны логин (Telegram id) и пароль');
    }

    return await this.auth.login(login, password);
  }

  /**
   * Проверка живости сессии. Панель зовёт её при загрузке, чтобы не показывать
   * пустую таблицу с просроченным токеном, а сразу вернуть форму входа.
   */
  @Get('me')
  @UseGuards(AdminJwtGuard)
  me(@Req() request: IRequestWithAdmin): { adminId: string } {
    return { adminId: request.adminId };
  }
}
