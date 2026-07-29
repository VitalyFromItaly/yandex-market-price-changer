import { HttpClient, httpClient } from './index';

/**
 * Тестирование POST запросов для диагностики проблем
 */

async function testBasicPost() {
  console.log('\n📋 Test 1: Basic POST request');

  const testData = {
    name: 'Test User',
    email: 'test@example.com',
    age: 25,
  };

  try {
    const response = await httpClient.postWithDiagnostics('https://httpbin.org/post', testData);

    console.log('✅ Success! Data sent and received back:');
    console.log('Sent data:', testData);
    console.log('Received back:', response.data?.json);

    return response.data?.json;
  } catch (error) {
    console.error('❌ Failed:', error.message);
    return null;
  }
}

async function testPostWithHeaders() {
  console.log('\n📋 Test 2: POST with custom headers');

  const testData = {
    message: 'Custom headers test',
    timestamp: Date.now(),
  };

  try {
    const response = await httpClient.postWithDiagnostics('https://httpbin.org/post', testData, {
      headers: {
        'X-Custom-Header': 'test-value',
        'User-Agent': 'HttpClient-Test/1.0',
      },
    });

    console.log('✅ Success with custom headers!');
    console.log('Request headers received:', response.data?.headers);

    return response.data;
  } catch (error) {
    console.error('❌ Failed:', error.message);
    return null;
  }
}

async function testPostWithFormData() {
  console.log('\n📋 Test 3: POST with FormData');

  const formData = new FormData();
  formData.append('field1', 'value1');
  formData.append('field2', 'value2');
  formData.append('json_data', JSON.stringify({ nested: 'object' }));

  try {
    const response = await httpClient.postWithDiagnostics('https://httpbin.org/post', formData);

    console.log('✅ FormData POST successful!');
    console.log('Form data received:', response.data?.form);

    return response.data?.form;
  } catch (error) {
    console.error('❌ Failed:', error.message);
    return null;
  }
}

async function testPostWithStringData() {
  console.log('\n📋 Test 4: POST with string data');

  const stringData = 'plain text data';

  try {
    const response = await httpClient.postWithDiagnostics('https://httpbin.org/post', stringData, {
      headers: {
        'Content-Type': 'text/plain',
      },
    });

    console.log('✅ String POST successful!');
    console.log('String data received:', response.data?.data);

    return response.data?.data;
  } catch (error) {
    console.error('❌ Failed:', error.message);
    return null;
  }
}

async function testPostWithYandexMarketAPI() {
  console.log('\n📋 Test 5: Simulated Yandex Market API call');

  const priceUpdateData = {
    offers: [
      {
        offerId: 'test-product-1',
        price: {
          value: 1500,
          currencyId: 'RUR',
        },
      },
      {
        offerId: 'test-product-2',
        price: {
          value: 2500,
          currencyId: 'RUR',
        },
      },
    ],
  };

  // Используем httpbin для имитации Yandex API
  const client = new HttpClient({
    baseURL: 'https://httpbin.org',
    headers: {
      Authorization: 'Bearer test-token',
      Accept: 'application/json',
    },
  });

  try {
    const response = await client.postWithDiagnostics('/post', priceUpdateData);

    console.log('✅ Yandex API simulation successful!');
    console.log('Sent offers:', priceUpdateData.offers.length);
    console.log('Data structure preserved:', !!response.data?.json?.offers);

    return response.data?.json;
  } catch (error) {
    console.error('❌ Failed:', error.message);
    return null;
  }
}

async function testEmptyPost() {
  console.log('\n📋 Test 6: POST without data');

  try {
    const response = await httpClient.postWithDiagnostics('https://httpbin.org/post');

    console.log('✅ Empty POST successful!');
    console.log('Response received:', !!response.data);

    return response.data;
  } catch (error) {
    console.error('❌ Failed:', error.message);
    return null;
  }
}

async function testLargeDataPost() {
  console.log('\n📋 Test 7: POST with large data');

  // Создаем большой объект данных
  const largeData = {
    metadata: {
      source: 'test',
      timestamp: new Date().toISOString(),
      version: '1.0',
    },
    items: Array.from({ length: 100 }, (_, i) => ({
      id: `item-${i}`,
      name: `Test Item ${i}`,
      description: `This is a test item with ID ${i}. `.repeat(10),
      properties: {
        weight: Math.random() * 100,
        price: Math.random() * 1000,
        inStock: Math.random() > 0.5,
        tags: [`tag-${i}`, `category-${i % 10}`, 'test'],
      },
    })),
  };

  try {
    const response = await httpClient.postWithDiagnostics('https://httpbin.org/post', largeData);

    console.log('✅ Large data POST successful!');
    console.log('Items sent:', largeData.items.length);
    console.log('Items received back:', response.data?.json?.items?.length || 0);

    return response.data?.json;
  } catch (error) {
    console.error('❌ Failed:', error.message);
    return null;
  }
}

export async function runAllPostTests() {
  console.log('🚀 Starting HttpClient POST diagnostics...\n');

  const results = [];

  // Запускаем все тесты
  results.push(await testBasicPost());
  results.push(await testPostWithHeaders());
  results.push(await testPostWithFormData());
  results.push(await testPostWithStringData());
  results.push(await testPostWithYandexMarketAPI());
  results.push(await testEmptyPost());
  results.push(await testLargeDataPost());

  // Подводим итоги
  const successful = results.filter((result) => result !== null).length;
  const total = results.length;

  console.log('\n📊 Test Summary:');
  console.log(`✅ Successful: ${successful}/${total}`);
  console.log(`❌ Failed: ${total - successful}/${total}`);

  if (successful === total) {
    console.log('🎉 All POST tests passed! HTTP client is working correctly.');
  } else {
    console.log('⚠️ Some tests failed. Check the detailed logs above.');
  }

  return {
    successful,
    total,
    results,
  };
}

// Быстрый тест
export async function quickPostTest() {
  console.log('⚡ Quick POST test...');

  const testData = { test: true, message: 'Quick test' };

  try {
    const response = await httpClient.post('https://httpbin.org/post', testData);
    console.log('✅ Quick test passed');
    return response.data?.json;
  } catch (error) {
    console.error('❌ Quick test failed:', error.message);
    return null;
  }
}
