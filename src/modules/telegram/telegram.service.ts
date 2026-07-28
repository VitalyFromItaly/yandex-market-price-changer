import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Response } from 'express';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Bot, BotDocument } from '../../database/schemas/bot.schema';
import { SubscriptionService } from '../../database/services/subscription.service';
import { YandexMarketService } from '../../database/services/yandex-market.service';
import BotFather from './bots/bot.father';
import { EBotType } from './domain.telegram';
import { FileUploadService } from './services/file-upload.service';
import { FileProcessingService } from './queue/services/file-processing.service';
import { AppConfigService } from '../../config/app-config.service';

@Injectable()
export class TelegramService implements OnModuleInit {
  private botFather: BotFather;

  constructor(
    @InjectModel(Bot.name) private botModel: Model<BotDocument>,
    private subscriptionService: SubscriptionService,
    private yandexMarketService: YandexMarketService,
    private fileProcessingService: FileProcessingService,
    private appConfig: AppConfigService,
  ) {
    this.botFather = new BotFather(
      this.botModel,
      this.subscriptionService,
      this.yandexMarketService,
      this.fileProcessingService,
      this.appConfig,
    );
  }

  async onModuleInit() {
    FileUploadService.init();
    await this.botFather.boot();
  }

  async createBot(body: {
    token: string;
    type: string;
    name: string;
    status?: string;
    description?: string;
  }) {
    const { token, type, name, status, description } = body;
    const botByToken = await this.botModel.findOne({ token });

    if (botByToken) {
      return { error: 'bot with this token already exists' };
    }

    return await this.botModel.create({
      token,
      type,
      name,
      status,
      description,
    });
  }

  public async handleWebhook(
    type: string,
    id: string,
    body: any,
    res: Response,
  ) {
    const bot = this.botFather.findBot({ id, type: type as EBotType });

    if (!bot) {
      throw new NotFoundException(`Bot with id ${id} not found`);
    }

    console.log(`Webhook for ${type} with id ${id}`);
    try {
      await bot.handleUpdate(body, res);
      return {
        status: 'success',
      };
    } catch (error) {
      console.error('Error handling webhook:', error);
      throw new BadRequestException(error);
    }
  }

  // Пример методов для работы с подписками
  async createUserSubscription(
    user_id: number,
    chat_id: number,
    plan: 'day' | 'week' | 'month' | 'year' = 'week',
  ) {
    return await this.subscriptionService.createSubscription({
      user_id,
      chat_id,
      plan,
    });
  }

  async checkUserSubscription(
    user_id: number,
    chat_id: number,
  ): Promise<boolean> {
    return await this.subscriptionService.isSubscriptionActive(
      user_id,
      chat_id,
    );
  }

  // Пример методов для работы с Yandex Market
  async createYandexMarketConfig(
    telegramUserId: string,
    telegramChatId: string,
    config: {
      campaign_id?: string;
      business_id?: string;
      token?: string;
      priceCoefficient?: number;
    },
  ) {
    return await this.yandexMarketService.upsertByTelegramUser(
      telegramUserId,
      telegramChatId,
      config,
    );
  }

  async getUserYandexMarketConfig(telegramUserId: string) {
    return await this.yandexMarketService.findByTelegramUser(telegramUserId);
  }

  // Методы для работы с ботами
  async findAllBots() {
    return this.botModel.find();
  }

  async findBotById(id: string) {
    return this.botModel.findById(id);
  }

  async findBotByToken(token: string) {
    return this.botModel.findOne({ token });
  }
}
