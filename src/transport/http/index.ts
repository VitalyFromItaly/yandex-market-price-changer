import type {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  AxiosError,
  InternalAxiosRequestConfig,
} from 'axios';

import axios from 'axios';

/**
 * Конфигурация для HTTP клиента
 */
export interface HttpClientConfig {
  baseURL?: string;
  timeout?: number;
  headers?: Record<string, string>;
  retries?: number;
  retryDelay?: number;
}

/**
 * Интерфейс для HTTP ответа
 */
export interface HttpResponse<T = any> {
  data: T;
  status: number;
  statusText: string;
  headers: any;
}

/**
 * Интерфейс для HTTP клиента
 */
export interface IHttpClient {
  setBaseURL(baseURL: string): void;

  setDefaultHeaders(headers: Record<string, string>): void;

  setAuthToken(token: string, type?: 'Bearer' | 'Basic'): void;

  removeAuthToken(): void;

  get<T = any>(url: string, config?: AxiosRequestConfig): Promise<HttpResponse<T>>;

  post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<HttpResponse<T>>;

  put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<HttpResponse<T>>;

  patch<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<HttpResponse<T>>;

  delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<HttpResponse<T>>;

  head(url: string, config?: AxiosRequestConfig): Promise<HttpResponse>;

  options(url: string, config?: AxiosRequestConfig): Promise<HttpResponse>;

  getAxiosInstance(): AxiosInstance;
}

/**
 * HTTP клиент на основе axios
 */
export class HttpClient implements IHttpClient {
  private readonly axiosInstance: AxiosInstance;
  private config: HttpClientConfig;

  constructor(config: HttpClientConfig = {}) {
    this.config = {
      timeout: 30000,
      retries: 3,
      retryDelay: 1000,
      ...config,
    };

    this.axiosInstance = axios.create({
      baseURL: this.config.baseURL,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json',
        ...this.config.headers,
      },
    });

    this.setupInterceptors();
  }

  /**
   * Настройка интерцепторов
   */
  private setupInterceptors(): void {
    // Интерцептор запросов
    this.axiosInstance.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        // Логирование запросов
        console.log(`🚀 HTTP Request: ${config.method?.toUpperCase()} ${config.url}`);

        console.log('Request Data', config.data);
        return config;
      },
      (error: AxiosError) => {
        console.error('❌ Request Error:', error);
        return Promise.reject(error);
      },
    );

    // Интерцептор ответов
    this.axiosInstance.interceptors.response.use(
      (response: AxiosResponse) => {
        console.log(`✅ HTTP Response: ${response.status} ${response.config.url}`);
        return response;
      },
      async (error: AxiosError) => {
        console.error(
          `❌ HTTP Error: ${error.response?.status || 'Unknown'} ${error.config?.url || 'Unknown URL'}`,
        );
        console.error('Error details:', {
          message: error.message,
          code: error.code,
          status: error.response?.status,
          statusText: error.response?.statusText,
          url: error.config?.url,
          method: error.config?.method,
        });

        // Автоматические повторы при ошибках сети
        if (this.shouldRetry(error)) {
          return this.retryRequest(error);
        }

        return Promise.reject(this.formatError(error));
      },
    );
  }

  /**
   * Проверка, нужно ли повторять запрос
   */
  private shouldRetry(error: AxiosError): boolean {
    // Проверяем, что config существует
    if (!error.config) {
      return false;
    }

    const config = error.config as any;
    const retryCount = config.__retryCount || 0;

    return (
      retryCount < (this.config.retries || 3) &&
      (!error.response || error.response.status >= 500) &&
      error.code !== 'ECONNABORTED' // не повторяем при таймауте
    );
  }

  /**
   * Повтор запроса с задержкой
   */
  private async retryRequest(error: AxiosError): Promise<AxiosResponse> {
    if (!error.config) {
      throw error; // Если нет config, не можем повторить запрос
    }

    const config = error.config as any;
    config.__retryCount = (config.__retryCount || 0) + 1;

    const delay = this.config.retryDelay! * config.__retryCount;
    console.log(
      `🔄 Retrying request (${config.__retryCount}/${this.config.retries}) after ${delay}ms`,
    );

    await new Promise((resolve) => setTimeout(resolve, delay));
    return this.axiosInstance.request(config);
  }

  /**
   * Форматирование ошибки
   */
  private formatError(error: AxiosError): Error {
    if (error.response) {
      // Сервер ответил с кодом ошибки
      return new Error(
        `HTTP Error ${error.response.status}: ${error.response.statusText} - ${JSON.stringify(error.response.data)}`,
      );
    } else if (error.request) {
      // Запрос был отправлен, но ответа не получено
      return new Error(`Network Error: No response received - ${error.message}`);
    } else {
      // Ошибка при настройке запроса
      return new Error(`Request Error: ${error.message}`);
    }
  }

  /**
   * Установка базового URL
   */
  public setBaseURL(baseURL: string): void {
    this.axiosInstance.defaults.baseURL = baseURL;
  }

  /**
   * Установка заголовков по умолчанию
   */
  public setDefaultHeaders(headers: Record<string, string>): void {
    Object.assign(this.axiosInstance.defaults.headers.common, headers);
  }

  /**
   * Установка токена авторизации
   */
  public setAuthToken(token: string, type: 'Bearer' | 'Basic' = 'Bearer'): void {
    this.axiosInstance.defaults.headers.common['Authorization'] = `${type} ${token}`;
  }

  /**
   * Удаление токена авторизации
   */
  public removeAuthToken(): void {
    delete this.axiosInstance.defaults.headers.common['Authorization'];
  }

  /**
   * GET запрос
   */
  public async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<HttpResponse<T>> {
    const response = await this.axiosInstance.get<T>(url, config);
    return {
      data: response.data,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    };
  }

  /**
   * POST запрос
   */
  public async post<T = any, P = any>(
    url: string,
    data?: P,
    config?: AxiosRequestConfig,
  ): Promise<HttpResponse<T>> {
    console.log(`POST request to ${url} with data:`, data);
    const response = await this.axiosInstance.post<T>(url, data, config);
    return {
      data: response.data,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    };
  }

  /**
   * PUT запрос
   */
  public async put<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig,
  ): Promise<HttpResponse<T>> {
    // Подготавливаем конфигурацию
    const requestConfig = { ...config };

    // Убеждаемся, что для JSON данных установлен правильный Content-Type
    if (data && typeof data === 'object' && !Buffer.isBuffer(data)) {
      if (!requestConfig.headers) {
        requestConfig.headers = {};
      }

      if (!requestConfig.headers['Content-Type'] && !requestConfig.headers['content-type']) {
        requestConfig.headers['Content-Type'] = 'application/json';
      }
    }

    const response = await this.axiosInstance.put<T>(url, data, requestConfig);
    return {
      data: response.data,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    };
  }

  /**
   * PATCH запрос
   */
  public async patch<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig,
  ): Promise<HttpResponse<T>> {
    // Подготавливаем конфигурацию
    const requestConfig = { ...config };

    // Убеждаемся, что для JSON данных установлен правильный Content-Type
    if (data && typeof data === 'object' && !Buffer.isBuffer(data)) {
      if (!requestConfig.headers) {
        requestConfig.headers = {};
      }

      if (!requestConfig.headers['Content-Type'] && !requestConfig.headers['content-type']) {
        requestConfig.headers['Content-Type'] = 'application/json';
      }
    }

    const response = await this.axiosInstance.patch<T>(url, data, requestConfig);
    return {
      data: response.data,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    };
  }

  /**
   * DELETE запрос
   */
  public async delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<HttpResponse<T>> {
    const response = await this.axiosInstance.delete<T>(url, config);
    return {
      data: response.data,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    };
  }

  /**
   * HEAD запрос
   */
  public async head(url: string, config?: AxiosRequestConfig): Promise<HttpResponse> {
    const response = await this.axiosInstance.head(url, config);
    return {
      data: response.data,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    };
  }

  /**
   * OPTIONS запрос
   */
  public async options(url: string, config?: AxiosRequestConfig): Promise<HttpResponse> {
    const response = await this.axiosInstance.options(url, config);
    return {
      data: response.data,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    };
  }

  /**
   * Прямой доступ к axios instance для продвинутого использования
   */
  public getAxiosInstance(): AxiosInstance {
    return this.axiosInstance;
  }

  /**
   * Диагностический POST запрос с подробным логированием
   */
  public async postWithDiagnostics<T = any, P = any>(
    url: string,
    data?: P,
    config?: AxiosRequestConfig,
  ): Promise<HttpResponse<T>> {
    console.log('🔍 POST Diagnostics:');
    console.log('URL:', url);
    console.log('Data provided:', !!data);
    console.log('Data type:', typeof data);
    console.log('Data content:', data);
    console.log('Config provided:', !!config);
    console.log('Config content:', config);

    return this.post<T, P>(url, data, config);
  }

  /**
   * Тестовый POST запрос для проверки отправки данных
   */
  public async testPost(): Promise<void> {
    console.log('🧪 Testing POST functionality...');

    const testData = {
      test: true,
      message: 'Test POST request',
      timestamp: new Date().toISOString(),
    };

    try {
      // Тест с httpbin.org для проверки POST запроса
      const response = await this.post('https://httpbin.org/post', testData);
      console.log('✅ POST test successful');
      console.log('Response received:', !!response.data);
      console.log('Request data echoed back:', response.data?.json);
    } catch (error) {
      console.error('❌ POST test failed:', error);
    }
  }

  /**
   * Создание нового HTTP клиента с другой конфигурацией
   * (для специфических случаев использования)
   */
  public static createInstance(config: HttpClientConfig): AxiosInstance {
    return axios.create({
      baseURL: config.baseURL,
      timeout: config.timeout || 30000,
      headers: {
        'Content-Type': 'application/json',
        ...config.headers,
      },
    });
  }
}

// Экспорт для удобного использования
export const httpClient = new HttpClient();
