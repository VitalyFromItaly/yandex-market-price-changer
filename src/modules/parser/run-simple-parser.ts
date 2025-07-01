#!/usr/bin/env node

/**
 * Простой скрипт для запуска парсера прайс-листа часов (плоский список)
 * Запуск: npx ts-node src/modules/parser/run-simple-parser.ts
 */

import { SimplePriceListParser, parseAndSaveSimple } from './simple-parser';
import * as path from 'path';

async function main() {
  try {
    console.log('🎯 Simple Price List Parser - Starting...\n');

    // Путь к Excel файлу
    const excelFilePath = path.join(__dirname, 'prices.xlsx');
    const outputDir = __dirname;

    console.log(`📁 Input file: ${excelFilePath}`);
    console.log(`📂 Output directory: ${outputDir}`);
    console.log(`🚀 Starting from row 9 (index 8)`);
    console.log(`📋 Output format: TParsedPriceRow[] (flat list)\n`);

    // Используем простую функцию для парсинга
    await parseAndSaveSimple(excelFilePath, outputDir);

    console.log('\n' + '='.repeat(50));
    console.log('🔍 Quick data preview:');
    console.log('-'.repeat(30));

    // Создаем экземпляр парсера для получения данных
    const parser = new SimplePriceListParser(excelFilePath);
    const data = await parser.parseToFlatList();

    // Показываем первые 5 товаров
    console.log('\n📦 First 5 items:');
    data.slice(0, 5).forEach((item, index) => {
      console.log(`  ${index + 1}. ${item.name} - ${item.price}₽ (${item.count} шт.)`);
    });

    // Показываем последние 5 товаров
    console.log('\n📦 Last 5 items:');
    data.slice(-5).forEach((item, index) => {
      const actualIndex = data.length - 5 + index + 1;
      console.log(`  ${actualIndex}. ${item.name} - ${item.price}₽ (${item.count} шт.)`);
    });

    // Поиск товаров GOODYEAR, ORIENT и других пропущенных групп
    console.log('\n🔍 Searching for previously missed items:');

    const searchTerms = ['GOODYEAR', 'ORIENT', 'символикой', 'LEVEL'];
    searchTerms.forEach(term => {
      const found = data.filter(item =>
        item.name.toUpperCase().includes(term.toUpperCase())
      );
      console.log(`  📍 Items containing "${term}": ${found.length}`);
      if (found.length > 0 && found.length <= 3) {
        found.forEach(item => {
          console.log(`    - ${item.name} - ${item.price}₽ (${item.count} шт.)`);
        });
      } else if (found.length > 3) {
        console.log(`    First 3 examples:`);
        found.slice(0, 3).forEach(item => {
          console.log(`    - ${item.name} - ${item.price}₽ (${item.count} шт.)`);
        });
      }
    });

    console.log('\n✅ Simple price list parsing completed successfully!');

  } catch (error) {
    console.error('❌ Error running simple price list parser:', error);
    process.exit(1);
  }
}

// Запускаем только если файл вызван напрямую
if (require.main === module) {
  main();
}

export { main as runSimplePriceListParser };
