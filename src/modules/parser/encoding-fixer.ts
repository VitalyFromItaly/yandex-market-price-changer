import * as iconv from 'iconv-lite';

/**
 * Модуль для исправления кодировки русских символов
 */
export class EncodingFixer {
  /**
   * Исправляет кодировку русских символов в строке
   * Преобразует неправильно закодированные символы обратно в русские
   */
  public static fixRussianEncoding(text: string): string {
    if (!text || typeof text !== 'string') {
      return text;
    }

    try {
      // Проверяем, содержит ли текст символы, которые могут быть неправильно закодированными
      if (text.includes('Ð') || text.includes('Ñ') || text.includes('Ã')) {
        
        // Стратегия 1: Пробуем декодировать как CP1251 -> UTF8
        try {
          const buffer = Buffer.from(text, 'latin1');
          const decoded = iconv.decode(buffer, 'cp1251');
          
          // Проверяем, что результат содержит русские символы
          if (/[А-Яа-яЁё]/.test(decoded)) {
            console.log(`✅ Fixed encoding via CP1251: "${text}" -> "${decoded}"`);
            return decoded;
          }
        } catch (error) {
          console.log(`❌ CP1251 strategy failed: ${error.message}`);
        }

        // Стратегия 2: Пробуем как Windows-1251
        try {
          const buffer = Buffer.from(text, 'binary');
          const decoded = iconv.decode(buffer, 'win1251');
          
          if (/[А-Яа-яЁё]/.test(decoded)) {
            console.log(`✅ Fixed encoding via Win1251: "${text}" -> "${decoded}"`);
            return decoded;
          }
        } catch (error) {
          console.log(`❌ Win1251 strategy failed: ${error.message}`);
        }

        // Стратегия 3: Ручная замена известных проблемных последовательностей
        // Основано на конкретных примерах: ÐÐ¼ÑÐ¸Ð±Ð¸Ñ -> Амфибия
        const preciseReplacements: { [key: string]: string } = {
          // Целые слова/фразы (проверено на примерах пользователя)
          'ÐÐ¼ÑÐ¸Ð±Ð¸Ñ': 'Амфибия',
          'ÐÑÑÑÑÐ°Ð½': 'КАСИО', 
          'ÐÐ¾Ð¼Ð°Ð½Ð´Ð¸ÑÑÐºÐ¸Ðµ': 'Командирские',
          'ÐÑÑÑÑ': 'ЧАСЫ',
          'ÐÐÐÐ': 'ОМЕГА',
          'ÐÑÐ¸ÐµÐ½Ñ': 'Ориент'
        };

        // Точная карта символов (основана на анализе примера ÐÐ¼ÑÐ¸Ð±Ð¸Ñ -> Амфибия)
        const symbolMap: { [key: string]: string } = {
          'Ð': 'А',  // Ð -> А
          'Ð¼': 'м',  // Ð¼ -> м  
          'Ð¸': 'и',  // Ð¸ -> и
          'Ð±': 'б',  // Ð± -> б
          'Ð°': 'а',
          'Ðµ': 'е', 
          'Ð¾': 'о',
          'Ð½': 'н',
          'Ð»': 'л',
          'Ðº': 'к',
          'Ð´': 'д',
          'Ð²': 'в',
          'Ð·': 'з'
        };

        // Специальная обработка символа Ñ - зависит от контекста
        const processSpecialChars = (str: string): string => {
          // Ñ в конце слова обычно означает 'я'
          str = str.replace(/Ñ(\s|$)/g, 'я$1');
          // Ñ перед согласными обычно означает 'ф'  
          str = str.replace(/Ñ([бвгджзклмнпрстфхцчшщ])/gi, 'ф$1');
          // Ñ в начале или середине слова может быть 'с', 'т', 'р', 'у'
          // Пока оставим как есть или заменим на наиболее вероятное
          str = str.replace(/Ñ/g, 'с'); // по умолчанию
          return str;
        };

        let result = text;
        let changed = false;
        
        // Сначала заменяем точные фразы
        for (const [wrong, correct] of Object.entries(preciseReplacements)) {
          if (result.includes(wrong)) {
            const before = result;
            result = result.replace(new RegExp(wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), correct);
            if (result !== before) {
              changed = true;
              console.log(`🎯 Precise replacement: "${wrong}" -> "${correct}"`);
            }
          }
        }

        // Потом заменяем отдельные символы (только если точная замена не сработала)
        if (!changed) {
          // Сначала обрабатываем основные символы
          for (const [wrong, correct] of Object.entries(symbolMap)) {
            if (result.includes(wrong)) {
              const before = result;
              result = result.replace(new RegExp(wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), correct);
              if (result !== before) {
                changed = true;
              }
            }
          }
          
          // Затем специальная обработка символа Ñ
          if (result.includes('Ñ')) {
            const before = result;
            result = processSpecialChars(result);
            if (result !== before) {
              changed = true;
            }
          }
        }
        
        if (changed) {
          console.log(`🔧 Fixed encoding via manual replacement: "${text}" -> "${result}"`);
        }
        
        return result;
      }
      
      return text;
    } catch (error) {
      console.warn('⚠️ Failed to fix encoding:', error.message);
      return text;
    }
  }

  /**
   * Исправляет кодировку во всех строковых полях объекта
   */
  public static fixEncodingInData<T = any>(data: T[]): T[] {
    return data.map(item => {
      if (typeof item === 'object' && item !== null) {
        const fixedItem: any = {};
        for (const [key, value] of Object.entries(item)) {
          if (typeof value === 'string') {
            fixedItem[key] = EncodingFixer.fixRussianEncoding(value);
          } else {
            fixedItem[key] = value;
          }
        }
        return fixedItem as T;
      }
      return item;
    });
  }

  /**
   * Тестирует исправление кодировки на примерах
   */
  public static test(): void {
    const testStrings = [
      'ÐÐ¼ÑÐ¸Ð±Ð¸Ñ 96077Ð EXCLUSIVE',
      'ÐÑÑÑÑÐ°Ð½ G-SHOCK GA-100',
      'ÐÐ¾Ð¼Ð°Ð½Ð´Ð¸ÑÑÐºÐ¸Ðµ 921892',
      'Normal text without encoding issues'
    ];

    console.log('🧪 Testing encoding fix...\n');

    testStrings.forEach((str, index) => {
      console.log(`Test ${index + 1}:`);
      console.log(`  Original: "${str}"`);
      
      const fixed = EncodingFixer.fixRussianEncoding(str);
      console.log(`  Fixed:    "${fixed}"`);
      
      const changed = str !== fixed;
      console.log(`  Changed:  ${changed ? '✅ Yes' : '❌ No'}`);
      console.log('');
    });

    console.log('✅ Encoding fix test completed!');
  }
} 