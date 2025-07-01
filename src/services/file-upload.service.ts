import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import axios from 'axios';

export interface IUploadedFile {
  filename: string;
  originalName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: Date;
  telegramFileId: string;
  userId: string;
}

export interface IFileUploadResult {
  success: boolean;
  file?: IUploadedFile;
  error?: string;
}

export class FileUploadService {
  private static readonly TEMP_DIR = path.join(process.cwd(), 'static', 'temp');
  private static readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  private static readonly ALLOWED_EXTENSIONS = ['.xlsx', '.xls', '.csv'];
  private static readonly ALLOWED_MIME_TYPES = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.ms-excel', // .xls
    'text/csv', // .csv
    'application/csv' // .csv альтернативный
  ];

  /**
   * Инициализация - создание папки для временных файлов
   */
  static async init(): Promise<void> {
    try {
      if (!fs.existsSync(this.TEMP_DIR)) {
        fs.mkdirSync(this.TEMP_DIR, { recursive: true });
        console.log(`📁 Created temp directory: ${this.TEMP_DIR}`);
      }
    } catch (error) {
      console.error('❌ Error creating temp directory:', error);
      throw error;
    }
  }

  /**
   * Загрузка файла из Telegram
   */
  static async downloadTelegramFile(
    botToken: string,
    telegramFileId: string,
    userId: string,
    originalFileName?: string
  ): Promise<IFileUploadResult> {
    try {
      // Получаем информацию о файле от Telegram API
      const fileInfoResponse = await axios.get(
        `https://api.telegram.org/bot${botToken}/getFile?file_id=${telegramFileId}`
      );

      if (!fileInfoResponse.data.ok) {
        return {
          success: false,
          error: 'Не удалось получить информацию о файле от Telegram'
        };
      }

      const fileInfo = fileInfoResponse.data.result;
      const filePath = fileInfo.file_path;
      const fileSize = fileInfo.file_size;

      // Проверяем размер файла
      if (fileSize > this.MAX_FILE_SIZE) {
        return {
          success: false,
          error: `Файл слишком большой. Максимальный размер: ${this.MAX_FILE_SIZE / 1024 / 1024}MB`
        };
      }

      // Проверяем расширение файла
      const fileExtension = path.extname(filePath || originalFileName || '').toLowerCase();
      if (!this.ALLOWED_EXTENSIONS.includes(fileExtension)) {
        return {
          success: false,
          error: `Неподдерживаемый формат файла. Разрешены: ${this.ALLOWED_EXTENSIONS.join(', ')}`
        };
      }

      // Генерируем уникальное имя файла
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const randomId = crypto.randomBytes(8).toString('hex');
      const fileName = `${userId}_${timestamp}_${randomId}${fileExtension}`;
      const localFilePath = path.join(this.TEMP_DIR, fileName);

      // Скачиваем файл
      const fileDownloadUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
      const fileResponse = await axios.get(fileDownloadUrl, {
        responseType: 'stream',
        timeout: 30000, // 30 секунд
      });

      // Сохраняем файл
      const writeStream = fs.createWriteStream(localFilePath);
      fileResponse.data.pipe(writeStream);

      return new Promise((resolve) => {
        writeStream.on('finish', () => {
          const uploadedFile: IUploadedFile = {
            filename: fileName,
            originalName: originalFileName || `file${fileExtension}`,
            filePath: localFilePath,
            fileSize: fileSize,
            mimeType: this.getMimeTypeByExtension(fileExtension),
            uploadedAt: new Date(),
            telegramFileId: telegramFileId,
            userId: userId
          };

          console.log(`✅ File uploaded successfully: ${fileName}`);
          resolve({ success: true, file: uploadedFile });
        });

        writeStream.on('error', (error) => {
          console.error('❌ Error saving file:', error);
          resolve({
            success: false,
            error: 'Ошибка при сохранении файла'
          });
        });
      });

    } catch (error) {
      console.error('❌ Error downloading file from Telegram:', error);
      return {
        success: false,
        error: 'Ошибка при загрузке файла из Telegram'
      };
    }
  }

  /**
   * Проверка валидности файла
   */
  static validateFile(file: IUploadedFile): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Проверяем существование файла
    if (!fs.existsSync(file.filePath)) {
      errors.push('Файл не найден на сервере');
    }

    // Проверяем размер файла
    if (file.fileSize > this.MAX_FILE_SIZE) {
      errors.push(`Файл слишком большой (${(file.fileSize / 1024 / 1024).toFixed(2)}MB)`);
    }

    // Проверяем расширение
    const extension = path.extname(file.filename).toLowerCase();
    if (!this.ALLOWED_EXTENSIONS.includes(extension)) {
      errors.push(`Неподдерживаемое расширение: ${extension}`);
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Получение MIME типа по расширению файла
   */
  private static getMimeTypeByExtension(extension: string): string {
    const mimeTypes: { [key: string]: string } = {
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.xls': 'application/vnd.ms-excel',
      '.csv': 'text/csv'
    };

    return mimeTypes[extension.toLowerCase()] || 'application/octet-stream';
  }

  /**
   * Удаление временного файла
   */
  static async deleteFile(filePath: string): Promise<boolean> {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`🗑️ File deleted: ${filePath}`);
        return true;
      }
      return false;
    } catch (error) {
      console.error('❌ Error deleting file:', error);
      return false;
    }
  }

  /**
   * Очистка старых временных файлов (старше указанного времени)
   */
  static async cleanupOldFiles(maxAgeHours: number = 24): Promise<number> {
    try {
      if (!fs.existsSync(this.TEMP_DIR)) {
        return 0;
      }

      const files = fs.readdirSync(this.TEMP_DIR);
      const now = Date.now();
      const maxAge = maxAgeHours * 60 * 60 * 1000; // в миллисекундах
      let deletedCount = 0;

      for (const file of files) {
        const filePath = path.join(this.TEMP_DIR, file);
        const stats = fs.statSync(filePath);
        const fileAge = now - stats.mtime.getTime();

        if (fileAge > maxAge) {
          if (await this.deleteFile(filePath)) {
            deletedCount++;
          }
        }
      }

      console.log(`🧹 Cleanup completed. Deleted ${deletedCount} old files.`);
      return deletedCount;
    } catch (error) {
      console.error('❌ Error during cleanup:', error);
      return 0;
    }
  }

  /**
   * Получение информации о файле
   */
  static getFileInfo(filePath: string): { size: number; createdAt: Date } | null {
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const stats = fs.statSync(filePath);
      return {
        size: stats.size,
        createdAt: stats.birthtime
      };
    } catch (error) {
      console.error('❌ Error getting file info:', error);
      return null;
    }
  }

  /**
   * Получение списка всех временных файлов
   */
  static async getTempFiles(): Promise<IUploadedFile[]> {
    try {
      if (!fs.existsSync(this.TEMP_DIR)) {
        return [];
      }

      const files = fs.readdirSync(this.TEMP_DIR);
      const fileList: IUploadedFile[] = [];

      for (const file of files) {
        const filePath = path.join(this.TEMP_DIR, file);
        const stats = fs.statSync(filePath);
        const extension = path.extname(file).toLowerCase();

        if (this.ALLOWED_EXTENSIONS.includes(extension)) {
          fileList.push({
            filename: file,
            originalName: file,
            filePath: filePath,
            fileSize: stats.size,
            mimeType: this.getMimeTypeByExtension(extension),
            uploadedAt: stats.birthtime,
            telegramFileId: 'unknown',
            userId: 'unknown'
          });
        }
      }

      return fileList;
    } catch (error) {
      console.error('❌ Error getting temp files:', error);
      return [];
    }
  }
}
