import type { TParsedPriceRow } from './domain.parser';

import * as fs from 'fs';
import * as path from 'path';

import { SKU_PATTERNS } from './constants/sku-patterns';
import { EncodingFixer } from './encoding-fixer';

import { XlsxParser } from './index';

/**
 * Интерфейс для сырых данных из Excel
 */
interface RawExcelRow {
  [key: string]: any;
}

/**
 * Простой парсер прайс-листа часов
 * Создает плоский список всех товаров
 */
export class SimplePriceListParser {
  private parser: XlsxParser;
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.parser = XlsxParser.fromFile(filePath);
  }

  /**
   * Обрабатывает значение количества
   * Заменяет '>5' на 6, конвертирует в число
   */
  private processCount(value: any): number {
    if (!value) {
      return 0;
    }

    const stringValue = String(value).trim();

    // Обрабатываем случай '>5'
    if (stringValue === '>5') {
      return 6;
    }

    // Пытаемся конвертировать в число
    const numValue = Number(stringValue);
    return isNaN(numValue) ? 0 : Math.max(0, Math.floor(numValue));
  }

  /**
   * Обрабатывает значение цены
   */
  private processPrice(value: any): number {
    if (!value) return 0;

    // Преобразуем в строку и убираем все пробелы
    const stringValue = String(value).replace(/\s+/g, '');

    const numValue = Number(stringValue);
    return isNaN(numValue) ? 0 : Math.max(0, numValue);
  }

  /**
   * Очищает и нормализует название
   */
  private cleanName(value: any): string {
    if (!value) return '';
    let cleanedName = String(value).trim();

    // Исправляем кодировку русских символов если нужно
    cleanedName = EncodingFixer.fixRussianEncoding(cleanedName);

    return cleanedName;
  }

  /**
   * Извлекает SKU из названия товара
   * SKU может быть в различных форматах: артикул, код товара и т.д.
   */
  /**
   * Извлекает SKU из названия товара
   * Примеры:
   * ORIENT FAA02003B -> FAA02003B
   * CASIO A1000D-7 -> A1000D-7
   * Командирские 921892 с АПЗ -> 921892 с АПЗ
   * Амфибия 96077А EXCLUSIVE -> 96077А EXCLUSIVE
   */
  private extractSku(fullName: string): string {
    if (!fullName) return '';

    const name = fullName.trim();

    // Пробуем найти соответствие с паттернами
    for (const pattern of SKU_PATTERNS) {
      const match = name.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    // Если ничего не найдено, пробуем извлечь последнее слово, если оно похоже на SKU
    const words = name.split(/\s+/);
    const lastWord = words[words.length - 1];

    // Проверяем, похоже ли последнее слово на SKU (содержит цифры и/или дефисы)
    if (lastWord && /[0-9-]/.test(lastWord) && lastWord.length >= 3) {
      return lastWord;
    }

    // В крайнем случае возвращаем полное название как SKU
    return name;
  }

  /**
   * Простая хеш-функция для генерации SKU из названия
   */
  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Преобразуем в 32-битное целое число
    }
    return hash;
  }

  /**
   * Проверяет, является ли строка валидной для обработки
   */
  private isValidRow(row: RawExcelRow): boolean {
    // Проверяем, что есть название часов (вторая колонка - C1)
    const name = this.cleanName(row.C1);
    if (!name) {
      return false;
    }

    // Проверяем, что есть цена (пятая колонка - C4)
    const price = this.processPrice(row.C4);
    return price > 0;
  }

  /**
   * Проверяет, выглядит ли строка как просто SKU (без названия бренда)
   * SKU обычно содержит буквы, цифры, дефисы и имеет определенную длину
   */
  private looksLikeSKU(name: string): boolean {
    if (!name || name.length < 3) {
      return false;
    }

    // SKU обычно:
    // - Короткие (до 20 символов)
    // - Содержат буквы и цифры
    // - Могут содержать дефисы
    // - НЕ содержат пробелы (кроме редких случаев)
    // - НЕ содержат длинные описательные слова

    const trimmedName = name.trim();

    // Слишком длинное название - скорее всего полное название
    if (trimmedName.length > 25) {
      return false;
    }

    // Содержит много пробелов - скорее всего полное название
    const spaceCount = (trimmedName.match(/\s/g) || []).length;
    if (spaceCount > 2) {
      return false;
    }

    // Содержит описательные слова - скорее всего полное название
    const descriptiveWords = [
      'часы',
      'watch',
      'exclusive',
      'limited',
      'edition',
      'collection',
      'кварц',
      'автомат',
      'механ',
      'solar',
      'radio',
      'controlled',
      'амфибия',
      'командирские',
      'восток',
      'ориент',
      'orient',
      'casio',
    ];

    const lowerName = trimmedName.toLowerCase();
    const hasDescriptiveWords = descriptiveWords.some((word) => lowerName.includes(word));
    if (hasDescriptiveWords) {
      return false;
    }

    // Проверяем паттерны SKU:
    // - Содержит цифры И буквы (латинские или русские)
    // - Может содержать дефисы, точки
    const hasLetters = /[a-zA-ZА-Яа-яЁё]/.test(trimmedName);
    const hasNumbers = /[0-9]/.test(trimmedName);
    const _hasSpecialChars = /[-._]/.test(trimmedName);

    // SKU должен содержать и буквы, и цифры
    if (!hasLetters || !hasNumbers) {
      return false;
    }

    // Проверяем общие паттерны SKU
    const skuPatterns = [
      /^[A-Z0-9-]{3,15}$/i, // ABC123, A1B2C3, ABC-123
      /^[A-Z]+[0-9]+[A-Z]*$/i, // ABC123D, PRW6900YL
      /^[A-Z]{1,4}[-_][0-9A-Z-]{2,10}$/i, // ECB-10D-2A, WS-B1000-8B
      /^[0-9]{3,8}[А-Яа-яЁёA-Za-z]{0,3}$/i, // 58108А, 921892, 58108A
    ];

    return skuPatterns.some((pattern) => pattern.test(trimmedName));
  }

  /**
   * Парсит Excel файл и возвращает плоский список товаров
   */
  public async parseToFlatList(): Promise<TParsedPriceRow[]> {
    console.log('🚀 Starting simple price list parsing...');
    console.log(`📁 File: ${this.filePath}`);

    try {
      // Парсим файл начиная с 9-й строки (индекс 8)
      const result = this.parser.parse({
        startRow: 8, // 9-я строка в Excel (индексация с 0)
        header: false, // Не используем заголовки
        skipEmptyRows: false, // НЕ пропускаем пустые строки - они могут содержать названия брендов
        customHeaders: ['C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6'], // A, B, C, D, E, F, G
      });

      console.log(`📊 Total rows parsed: ${result.data.length}`);

      const flatList: TParsedPriceRow[] = [];
      let processedRows = 0;
      let skippedRows = 0;
      let currentBrand = ''; // Текущий бренд из ячейки C0

      result.data.forEach((row: RawExcelRow, index: number) => {
        const actualRowNumber = index + 9; // Для логирования

        // Проверяем, есть ли название бренда в ячейке C0
        const brandInC0 = this.cleanName(row.C0);
        if (brandInC0) {
          currentBrand = brandInC0;
          console.log(`🏷️ Brand detected in row ${actualRowNumber}: "${currentBrand}"`);
          return; // Пропускаем эту строку, но запоминаем бренд
        }

        // Проверяем валидность строки (есть ли товар)
        if (!this.isValidRow(row)) {
          skippedRows++;
          return;
        }

        // Извлекаем данные
        let name = this.cleanName(row.C1); // Название/SKU из колонки B
        const price = this.processPrice(row.C4); // Цена (колонка E)
        const count = this.processCount(row.C6); // Количество (колонка G)

        // Если название выглядит как просто SKU (без названия бренда), добавляем текущий бренд
        if (currentBrand && this.looksLikeSKU(name)) {
          const originalName = name;
          name = `${currentBrand} ${name}`;
          console.log(
            `🔗 Combined brand+SKU in row ${actualRowNumber}: "${originalName}" -> "${name}"`,
          );
        }

        const sku = this.extractSku(name); // Извлекаем SKU из названия

        // Создаем объект товара
        const item: TParsedPriceRow = {
          name,
          sku,
          price,
          count,
        };

        flatList.push(item);
        processedRows++;

        // Логируем каждый 100-й товар для отслеживания прогресса
        if (processedRows % 100 === 0) {
          console.log(`⌚ Processed ${processedRows} items...`);
        }
      });

      console.log('\n📈 Parsing Summary:');
      console.log(`✅ Processed rows: ${processedRows}`);
      console.log(`⏭️ Skipped rows: ${skippedRows}`);
      console.log(`📦 Total items: ${flatList.length}`);

      // Статистика
      const totalValue = flatList.reduce((sum, item) => sum + item.price * item.count, 0);
      const totalCount = flatList.reduce((sum, item) => sum + item.count, 0);
      const avgPrice = totalCount > 0 ? totalValue / totalCount : 0;

      console.log(`💰 Total value: ${totalValue.toFixed(2)}₽`);
      console.log(`📦 Total quantity: ${totalCount}`);
      console.log(`💸 Average price: ${avgPrice.toFixed(2)}₽`);

      // Дополнительная обработка кодировки для всех элементов
      console.log('🔧 Fixing encoding for all items...');
      const fixedList = EncodingFixer.fixEncodingInData(flatList);

      console.log('✅ Encoding fix completed');

      return fixedList;
    } catch (error) {
      console.error('❌ Error parsing price list:', error);
      throw error;
    }
  }

  /**
   * Сохраняет плоский список в JSON файл
   */
  public async saveToJson(data: TParsedPriceRow[], outputPath: string): Promise<void> {
    try {
      const jsonString = JSON.stringify(data, null, 2);
      fs.writeFileSync(outputPath, jsonString, 'utf-8');
      console.log(`💾 Data saved to: ${outputPath}`);
      console.log(`📏 File size: ${(jsonString.length / 1024).toFixed(2)} KB`);
      console.log(`📊 Items count: ${data.length}`);
    } catch (error) {
      console.error('❌ Error saving JSON:', error);
      throw error;
    }
  }

  /**
   * Создает детальный отчет о распарсенных данных
   */
  public generateReport(data: TParsedPriceRow[]): string {
    const report = [];

    report.push('📊 SIMPLE PRICE LIST PARSING REPORT');
    report.push('='.repeat(50));
    report.push('');

    const totalItems = data.length;
    const totalValue = data.reduce((sum, item) => sum + item.price * item.count, 0);
    const totalCount = data.reduce((sum, item) => sum + item.count, 0);
    const avgPrice = totalCount > 0 ? totalValue / totalCount : 0;

    report.push(`Total Items: ${totalItems}`);
    report.push(`Total Count: ${totalCount}`);
    report.push(`Total Value: ${totalValue.toFixed(2)}₽`);
    report.push(`Average Item Price: ${avgPrice.toFixed(2)}₽`);
    report.push('');

    // Топ-10 самых дорогих товаров
    const topExpensive = data.sort((a, b) => b.price - a.price).slice(0, 10);

    report.push('💰 Top 10 Most Expensive Items:');
    topExpensive.forEach((item, index) => {
      report.push(`  ${index + 1}. ${item.name} - ${item.price}₽ (${item.count} шт.)`);
    });
    report.push('');

    // Топ-10 товаров с наибольшим количеством
    const topQuantity = data.sort((a, b) => b.count - a.count).slice(0, 10);

    report.push('📦 Top 10 Items by Quantity:');
    topQuantity.forEach((item, index) => {
      report.push(`  ${index + 1}. ${item.name} - ${item.count} шт. (${item.price}₽)`);
    });
    report.push('');

    // Статистика по ценовым диапазонам
    const priceRanges = {
      'Under 500₽': data.filter((item) => item.price < 500).length,
      '500-800₽': data.filter((item) => item.price >= 500 && item.price < 800).length,
      '800-900₽': data.filter((item) => item.price >= 800 && item.price < 900).length,
      '900-1000₽': data.filter((item) => item.price >= 900 && item.price < 1000).length,
      'Over 1000₽': data.filter((item) => item.price >= 1000).length,
    };

    report.push('💸 Price Distribution:');
    Object.entries(priceRanges).forEach(([range, count]) => {
      const percentage = totalItems > 0 ? ((count / totalItems) * 100).toFixed(1) : '0.0';
      report.push(`  ${range}: ${count} items (${percentage}%)`);
    });
    report.push('');

    // Товары с количеством >5 (которые были заменены на 6)
    const highStock = data.filter((item) => item.count === 6);
    report.push(`📈 Items with high stock (>5): ${highStock.length}`);
    if (highStock.length > 0) {
      report.push('Examples:');
      highStock.slice(0, 5).forEach((item, index) => {
        report.push(`  ${index + 1}. ${item.name} - ${item.price}₽`);
      });
    }

    return report.join('\n');
  }

  /**
   * Основной метод для полного парсинга и сохранения
   */
  public async parseAndSave(outputDir: string = './src/modules/parser'): Promise<{
    data: TParsedPriceRow[];
    jsonPath: string;
    reportPath: string;
  }> {
    console.log('🎯 Starting simple price list processing...\n');

    // Парсим данные
    const data = await this.parseToFlatList();

    // Определяем пути для сохранения
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const jsonPath = path.join(outputDir, `simple-price-list-${timestamp}.json`);
    const reportPath = path.join(outputDir, `simple-price-report-${timestamp}.txt`);

    // Сохраняем JSON
    await this.saveToJson(data, jsonPath);

    // Генерируем и сохраняем отчет
    const report = this.generateReport(data);
    fs.writeFileSync(reportPath, report, 'utf-8');
    console.log(`📋 Report saved to: ${reportPath}`);

    console.log('\n🎉 Simple processing completed successfully!');

    return {
      data,
      jsonPath,
      reportPath,
    };
  }
}

/**
 * Быстрая функция для простого парсинга прайс-листа
 */
export async function parseToFlatList(
  filePath: string = './src/modules/parser/prices.xlsx',
): Promise<TParsedPriceRow[]> {
  const parser = new SimplePriceListParser(filePath);
  return await parser.parseToFlatList();
}

/**
 * Функция для полного простого парсинга с сохранением
 */
export async function parseAndSaveSimple(
  filePath: string = './src/modules/parser/prices.xlsx',
  outputDir: string = './src/modules/parser',
): Promise<void> {
  const parser = new SimplePriceListParser(filePath);
  const result = await parser.parseAndSave(outputDir);

  console.log('\n📁 Generated files:');
  console.log(`JSON: ${result.jsonPath}`);
  console.log(`Report: ${result.reportPath}`);
  console.log(`Total items: ${result.data.length}`);
}
