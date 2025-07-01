import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import * as iconv from 'iconv-lite';

/**
 * Интерфейс для конфигурации парсера
 */
export interface XlsxParseOptions {
  /** Имя листа для парсинга (по умолчанию первый лист) */
  sheetName?: string;
  /** Начальная строка (по умолчанию 0) */
  startRow?: number;
  /** Конечная строка (по умолчанию все строки) */
  endRow?: number;
  /** Начальная колонка (по умолчанию 0) */
  startCol?: number;
  /** Конечная колонка (по умолчанию все колонки) */
  endCol?: number;
  /** Использовать первую строку как заголовки (по умолчанию true) */
  header?: boolean;
  /** Кастомные заголовки (если header = false) */
  customHeaders?: string[];
  /** Пропускать пустые строки (по умолчанию true) */
  skipEmptyRows?: boolean;
  /** Форматировать даты как строки (по умолчанию false) */
  dateNF?: string;
  /** Включать информацию о листе в результат */
  includeSheetInfo?: boolean;
}

/**
 * Интерфейс для результата парсинга
 */
export interface ParseResult<T = any> {
  /** Распарсенные данные */
  data: T[];
  /** Информация о листе */
  sheetInfo: {
    name: string;
    range: string;
    rowCount: number;
    colCount: number;
  };
  /** Заголовки колонок */
  headers: string[];
  /** Метаданные файла */
  fileInfo: {
    fileName: string;
    fileSize: number;
    sheets: string[];
    parsedAt: Date;
  };
}

/**
 * Класс для парсинга XLSX файлов
 */
export class XlsxParser {
  private workbook: XLSX.WorkBook | null = null;
  private filePath: string = '';

  /**
   * Загружает XLSX файл
   */
  public loadFile(filePath: string): this {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const ext = path.extname(filePath).toLowerCase();
    if (!['.xlsx', '.xls', '.csv'].includes(ext)) {
      throw new Error(`Unsupported file format: ${ext}. Supported: .xlsx, .xls, .csv`);
    }

    try {
      // Добавляем опции для правильной работы с кодировкой
      this.workbook = XLSX.readFile(filePath, {
        type: 'file',
        codepage: 65001, // UTF-8 кодировка для русских символов
        cellText: false,
        cellDates: true,
        raw: false // Преобразовывать числа и строки корректно
      });
      this.filePath = filePath;
      return this;
    } catch (error) {
      throw new Error(`Failed to read file: ${error.message}`);
    }
  }

  /**
   * Загружает XLSX файл из буфера
   */
  public loadBuffer(buffer: Buffer, fileName: string = 'buffer.xlsx'): this {
    try {
      this.workbook = XLSX.read(buffer, { 
        type: 'buffer',
        codepage: 65001,
        cellText: false,
        cellDates: true,
        raw: false
      });
      this.filePath = fileName;
      return this;
    } catch (error) {
      throw new Error(`Failed to read buffer: ${error.message}`);
    }
  }

  /**
   * Получает список листов в файле
   */
  public getSheetNames(): string[] {
    if (!this.workbook) {
      throw new Error('No workbook loaded. Call loadFile() first.');
    }
    return this.workbook.SheetNames;
  }

  /**
   * Парсит XLSX файл в JSON
   */
  public parse<T = any>(options: XlsxParseOptions = {}): ParseResult<T> {
    if (!this.workbook) {
      throw new Error('No workbook loaded. Call loadFile() first.');
    }

    const {
      sheetName,
      startRow = 0,
      endRow,
      startCol = 0,
      endCol,
      header = true,
      customHeaders = [],
      skipEmptyRows = true,
      dateNF,
      includeSheetInfo = true
    } = options;

    // Выбираем лист
    const targetSheetName = sheetName || this.workbook.SheetNames[0];
    const worksheet = this.workbook.Sheets[targetSheetName];

    if (!worksheet) {
      throw new Error(`Sheet "${targetSheetName}" not found. Available sheets: ${this.workbook.SheetNames.join(', ')}`);
    }

    // Получаем информацию о диапазоне
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');
    const actualEndRow = endRow ?? range.e.r;
    const actualEndCol = endCol ?? range.e.c;

    // Создаем новый диапазон с учетом параметров
    const newRange = {
      s: { r: startRow, c: startCol },
      e: { r: actualEndRow, c: actualEndCol }
    };

    // Парсим данные
    const jsonData = XLSX.utils.sheet_to_json(worksheet, {
      range: newRange,
      header: header ? 1 : customHeaders.length > 0 ? customHeaders : 1,
      defval: null,
      blankrows: !skipEmptyRows,
      dateNF: dateNF,
      raw: false,
      rawNumbers: false
    });

    // Получаем заголовки
    let headers: string[] = [];
    if (header && jsonData.length > 0) {
      headers = Object.keys(jsonData[0] as object);
    } else if (customHeaders.length > 0) {
      headers = customHeaders;
    } else {
      // Генерируем заголовки как A, B, C...
      headers = Array.from({ length: actualEndCol - startCol + 1 }, (_, i) =>
        String.fromCharCode(65 + i)
      );
    }

    // Фильтруем пустые строки если нужно
    const filteredData = skipEmptyRows
      ? jsonData.filter(row => Object.values(row as object).some(value => value !== null && value !== ''))
      : jsonData;

    // Получаем информацию о файле
    const fileStats = fs.existsSync(this.filePath) ? fs.statSync(this.filePath) : null;

    const result: ParseResult<T> = {
      data: filteredData as T[],
      sheetInfo: {
        name: targetSheetName,
        range: XLSX.utils.encode_range(newRange),
        rowCount: actualEndRow - startRow + 1,
        colCount: actualEndCol - startCol + 1
      },
      headers,
      fileInfo: {
        fileName: path.basename(this.filePath),
        fileSize: fileStats?.size || 0,
        sheets: this.workbook.SheetNames,
        parsedAt: new Date()
      }
    };

    return result;
  }

  /**
   * Парсит все листы файла
   */
  public parseAllSheets<T = any>(options: Omit<XlsxParseOptions, 'sheetName'> = {}): Record<string, ParseResult<T>> {
    if (!this.workbook) {
      throw new Error('No workbook loaded. Call loadFile() first.');
    }

    const results: Record<string, ParseResult<T>> = {};

    for (const sheetName of this.workbook.SheetNames) {
      try {
        results[sheetName] = this.parse<T>({ ...options, sheetName });
      } catch (error) {
        console.warn(`Failed to parse sheet "${sheetName}": ${error.message}`);
      }
    }

    return results;
  }

  /**
   * Конвертирует данные в различные форматы
   */
  public convertTo(format: 'csv' | 'tsv' | 'html' | 'xml', sheetName?: string): string {
    if (!this.workbook) {
      throw new Error('No workbook loaded. Call loadFile() first.');
    }

    const targetSheetName = sheetName || this.workbook.SheetNames[0];
    const worksheet = this.workbook.Sheets[targetSheetName];

    if (!worksheet) {
      throw new Error(`Sheet "${targetSheetName}" not found.`);
    }

    switch (format) {
      case 'csv':
        return XLSX.utils.sheet_to_csv(worksheet);
      case 'tsv':
        return XLSX.utils.sheet_to_csv(worksheet, { FS: '\t' });
      case 'html':
        return XLSX.utils.sheet_to_html(worksheet);
      case 'xml':
        return XLSX.utils.sheet_to_formulae(worksheet).join('\n');
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  /**
   * Сохраняет результат парсинга в JSON файл
   */
  public saveToJson(result: ParseResult, outputPath: string, pretty: boolean = true): void {
    try {
      const jsonString = pretty
        ? JSON.stringify(result, null, 2)
        : JSON.stringify(result);

      fs.writeFileSync(outputPath, jsonString, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to save JSON file: ${error.message}`);
    }
  }

  /**
   * Получает статистику по данным
   */
  public getStats(data: any[]): {
    totalRows: number;
    nonEmptyRows: number;
    columns: Array<{
      name: string;
      nonEmptyCount: number;
      uniqueCount: number;
      dataTypes: string[];
    }>;
  } {
    if (data.length === 0) {
      return {
        totalRows: 0,
        nonEmptyRows: 0,
        columns: []
      };
    }

    const columns = Object.keys(data[0] as object);
    const columnStats = columns.map(colName => {
      const values = data.map(row => (row as any)[colName]).filter(val => val !== null && val !== '');
      const uniqueValues = [...new Set(values)];
      const dataTypes = [...new Set(values.map(val => typeof val))];

      return {
        name: colName,
        nonEmptyCount: values.length,
        uniqueCount: uniqueValues.length,
        dataTypes
      };
    });

    const nonEmptyRows = data.filter(row =>
      Object.values(row as object).some(val => val !== null && val !== '')
    ).length;

    return {
      totalRows: data.length,
      nonEmptyRows,
      columns: columnStats
    };
  }

  /**
   * Создает экземпляр парсера и сразу загружает файл
   */
  public static fromFile(filePath: string): XlsxParser {
    return new XlsxParser().loadFile(filePath);
  }

  /**
   * Создает экземпляр парсера из буфера
   */
  public static fromBuffer(buffer: Buffer, fileName?: string): XlsxParser {
    return new XlsxParser().loadBuffer(buffer, fileName);
  }


}

// Экспорт для удобного использования
export const xlsxParser = new XlsxParser();
