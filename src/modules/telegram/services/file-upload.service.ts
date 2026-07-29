import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

export interface IFileInfo {
  filename: string;
  originalName: string;
  filePath: string;
  fileSize: number;
  uploadedAt: Date;
}

/**
 * @deprecated Обслуживал загрузку прайс-листа для отключённого изменения цен.
 * Загрузка файла вернётся только под ОСТАТКИ (TASK-035) и должна быть написана
 * заново — этот класс переиспользовать нельзя.
 *
 * Причина: при миграции сервис ужали с 293 строк до 67 и потеряли ВСЮ
 * валидацию, которая была раньше:
 *
 * 1. Нет лимита размера (был 10 МБ) — скачивается файл любого объёма.
 * 2. Нет allowlist расширений (был .xlsx/.xls/.csv).
 * 3. Нет allowlist MIME-типов; параметр `mimeType` в saveFile принимается
 *    и не используется вообще.
 * 4. `response.data.pipe(writer)` вызывается ДО навешивания обработчика
 *    'error' на writer — ошибка в первые тики потеряется.
 * 5. Вызывающий код (FileUploadHandler) скачивает и ставит в очередь до
 *    какой-либо проверки подписки и готовности кредов.
 */
export class FileUploadService {
  private static readonly TEMP_DIR = path.join(process.cwd(), 'static', 'temp');

  public static init() {
    if (!fs.existsSync(this.TEMP_DIR)) {
      fs.mkdirSync(this.TEMP_DIR, { recursive: true });
    }
  }

  public async saveFile(
    fileUrl: string,
    originalName: string,
    mimeType: string,
    fileSize: number,
  ): Promise<IFileInfo> {
    const response = await axios({
      method: 'GET',
      url: fileUrl,
      responseType: 'stream',
    });

    const extension = path.extname(originalName) || '.tmp';
    const filename = `${Date.now()}-${Math.floor(Math.random() * 1000)}${extension}`;
    const filePath = path.join(FileUploadService.TEMP_DIR, filename);
    const writer = fs.createWriteStream(filePath);

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () =>
        resolve({
          filename,
          originalName,
          filePath,
          fileSize,
          uploadedAt: new Date(),
        }),
      );
      writer.on('error', reject);
    });
  }

  public static async deleteFile(filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      fs.unlink(filePath, (err) => {
        if (err) {
          console.error(`Error deleting file: ${filePath}`, err);
          return reject(err);
        }
        console.log(`File deleted: ${filePath}`);
        resolve();
      });
    });
  }
}
