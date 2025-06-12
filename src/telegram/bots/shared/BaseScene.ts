import { TTelegrafBot } from '../../domain.telegram';
import { Scenes, session } from 'telegraf';

export default class BaseScene {
  protected bot: TTelegrafBot;
  protected scenes = [];

  constructor(bot: TTelegrafBot) {
    this.bot = bot;
  }

  protected storeScene(scene: any) {
    this.scenes.push(scene);
  }

  public registerScenes() {
    const stage = new Scenes.Stage(this.scenes);
    this.bot.use(session()); // Подключаем сессии
    // @ts-ignore
    this.bot.use(stage.middleware()); // Подключаем сцены
  }
}
