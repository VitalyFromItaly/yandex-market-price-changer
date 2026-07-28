import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

export interface IFileInfo {
  filename: string;
  originalName: string;
  filePath: string;
  fileSize: number;
  uploadedAt: Date;
}

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
