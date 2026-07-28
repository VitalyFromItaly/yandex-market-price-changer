import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Response } from 'express';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Bot, BotDocument } from '../../database/schemas/bot.schema';
import { YandexMarketService } from '../../database/services/yandex-market.service';
import { BotRegistry } from './bots/bot-registry.service';

/**
 * Раньше здесь был шов между Nest и ручным графом `new`: конструктор создавал
 * BotFather и передавал ему инжектированные сервисы, а всё ниже жило без DI.
 * Теперь инициализацией ботов занимается BotRegistry (обычный провайдер с
 * OnApplicationBootstrap), а этот сервис отвечает только за прикладные операции.
 *
 * FileUploadService.init() убран из onModuleInit: приём документов снят
 * (TASK-009), каталог static/temp больше не нужен на старте.
 */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  constructor(
    @InjectModel(Bot.name) private botModel: Model<BotDocument>,
    private yandexMarketService: YandexMarketService,
    private readonly registry: BotRegistry,
  ) {}

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

    return await this.botModel.create({ token, type, name, status, description });
  }

  public async handleWebhook(type: string, id: string, body: any, res: Response) {
    if (!this.registry.find(type, id)) {
      throw new NotFoundException(`Bot with id ${id} not found`);
    }

    try {
      await this.registry.handleUpdate(type, id, body, res);
      return { status: 'success' };
    } catch (error) {
      this.logger.error(`Ошибка обработки вебхука ${type}/${id}`, error as Error);
      throw new BadRequestException(error);
    }
  }

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
