import { Logger } from '@nestjs/common';
import axios, { type AxiosError, type AxiosInstance } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';

import { type IRetryOptions, type TSleep, realSleep } from '../yandex/yandex-retry';

import { POLZA_RETRY, withPolzaRetry } from './polza-retry';
import { type PolzaApiError, PolzaDisabledError, toPolzaApiError } from './polza.errors';

/**
 * HTTP-клиент Polza.ai (OpenAI-совместимый агрегатор).
 *
 * На axios, а не на OpenAI SDK: из всего SDK нужны два GET и один POST без
 * стриминга, а зависимость тянула бы свою политику повторов — ту самую, которую
 * здесь нужно задать по документации Polza, а не по OpenAI.
 *
 * Наружу AiModule его НЕ отдаёт: единственная точка ИИ-функционала — AiService
 * (TASK-104), где проверяются фича продавца, лимит и учёт расхода. Клиент про
 * фичу `ai` не знает.
 *
 * Ключ живёт только в заголовке экземпляра axios. В логи идут статус, метод,
 * путь, code и trace_id — никогда `config.headers`: маскировщика Bearer нет ни
 * в maskSecrets, ни в maskOutgoing.
 */

/** У Polza потолок запроса 600 с; наш таймаут чуть больше, чтобы ответ сервера пришёл раньше обрыва. */
export const POLZA_TIMEOUT_MS = 620_000;

const NO_RETRY: IRetryOptions = { ...POLZA_RETRY, attempts: 1 };

export const POLZA_PATHS = {
  chatCompletions: '/v1/chat/completions',
  models: '/v1/models',
  balance: '/v2/balance',
} as const;

export interface IPolzaCredentials {
  /** База `<схема>://<хост>/api` без хвостового слеша (AppConfigService.polzaAiBaseUrl). */
  baseUrl: string;
  token?: string;
  /** Модель по умолчанию (POLZA_AI_MODEL). */
  model?: string;
  /** HTTP-прокси (POLZA_AI_PROXY_URL): TLS до Polza идёт сквозь CONNECT. */
  proxyUrl?: string;
}

export interface IPolzaClientOptions {
  retry?: IRetryOptions;
  sleep?: TSleep;
  timeoutMs?: number;
}

/** Параметры одного вызова — для системной пробы баланса. */
export interface IPolzaCallOptions {
  /** Обрывает запрос: монитор не должен оставлять висеть брошенный запрос до 620 с. */
  signal?: AbortSignal;
  /**
   * false — без собственных повторов 429/502/503. Монитору нужна причина: с
   * повторами 1+2+4 с ответ 503 не укладывается в его 10 с и читается как
   * «нет ответа». Повторяет монитор сам.
   */
  retry?: boolean;
}

/** Вызов функции, который попросила модель (TASK-147). */
export interface IPolzaToolCall {
  /** id вызова — ответ инструмента возвращается с ним же. */
  id: string;
  name: string;
  /** Аргументы — сырой строкой, как прислала модель: разбирает и проверяет исполнитель. */
  arguments: string;
}

/** Описание функции для модели — формат OpenAI `tools[]`, параметры — JSON Schema. */
export interface IPolzaTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * Сообщение диалога. Поля — camelCase, в тело уходят в snake_case
 * (`toWireMessage`): `tool_calls`, `tool_call_id`.
 */
export type IPolzaMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: IPolzaToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

export type TPolzaToolChoice = 'auto' | 'none' | 'required';

export interface IChatCompletionRequest {
  model?: string;
  messages: IPolzaMessage[];
  /** Передаётся как есть: `{type: 'json_object'}`, `{type: 'json_schema', json_schema: …}`. */
  responseFormat?: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
  tools?: IPolzaTool[];
  toolChoice?: TPolzaToolChoice;
}

export interface IPolzaUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  /** usage.cost_rub как есть — без пересчёта. */
  costRub: number;
}

export interface IChatCompletionResult {
  /** Пустая строка, если модель вместо текста попросила инструменты. */
  content: string;
  /** Пусто — инструменты не просились. */
  toolCalls: IPolzaToolCall[];
  /** `stop`, `tool_calls`, `length`…; пустая строка — поле не пришло. */
  finishReason: string;
  usage: IPolzaUsage;
  model: string;
  provider: string;
  /** `id` ответа (gen_…) — по нему запрос находится в кабинете Polza. */
  traceId: string;
}

export interface IPolzaBalance {
  amount: number;
  available: number;
  /** Нет, если у участника персональный лимит. */
  reservedAmount: number | null;
  spentAmount: number | null;
  updatedAt: string | null;
}

/** Цена модели у Polza — в рублях за миллион токенов (`top_provider.pricing`, строки с 8 знаками). */
export interface IPolzaModelPricing {
  promptPerMillionRub: number;
  completionPerMillionRub: number;
}

export interface IPolzaModel {
  id: string;
  name?: string;
  /** `chat`, `embedding`, `image`, `tts`… — у Polza в одном списке модели всех видов. */
  type?: string;
  contextLength: number | null;
  /**
   * null — цена неизвестна: потокенной у модели нет (tts, image — там тарифы за штуку),
   * валюта не рубли или поле не пришло. Не 0: «неизвестно» не значит «бесплатно».
   */
  pricing: IPolzaModelPricing | null;
  /** В `supported_parameters` есть `structured_outputs` — `response_format: json_schema` модель держит. */
  structuredOutputs: boolean;
  /** В `supported_parameters` есть `tools` — модель заявляет вызов функций (TASK-147). */
  tools: boolean;
}

export class PolzaClient {
  private readonly logger = new Logger(PolzaClient.name);
  private readonly http: AxiosInstance;
  private readonly retry: IRetryOptions;
  private readonly sleep: TSleep;

  constructor(
    private readonly credentials: IPolzaCredentials,
    options: IPolzaClientOptions = {},
  ) {
    this.retry = options.retry ?? POLZA_RETRY;
    this.sleep = options.sleep ?? realSleep;

    this.http = axios.create({
      baseURL: credentials.baseUrl,
      timeout: options.timeoutMs ?? POLZA_TIMEOUT_MS,
      // Свой агент, а не `proxy` axios: тот для https-адреса шлёт прокси обычный
      // HTTP-запрос вместо CONNECT. `proxy: false` — не брать HTTPS_PROXY из env:
      // прокси Polza задаётся только явно и не касается остального трафика.
      ...(credentials.proxyUrl
        ? { httpsAgent: new HttpsProxyAgent(credentials.proxyUrl), proxy: false as const }
        : {}),
      headers: {
        'Content-Type': 'application/json',
        ...(credentials.token ? { Authorization: `Bearer ${credentials.token}` } : {}),
      },
    });

    this.http.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => Promise.reject(this.toDomainError(error)),
    );
  }

  /** Включён ли клиент — есть ли ключ. Решение «включён ли ИИ» — AppConfigService.polzaAiEnabled. */
  public get enabled(): boolean {
    return Boolean(this.credentials.token);
  }

  public async chatCompletion(request: IChatCompletionRequest): Promise<IChatCompletionResult> {
    this.assertEnabled();
    const body: Record<string, unknown> = {
      model: request.model ?? this.credentials.model,
      messages: request.messages.map(toWireMessage),
    };
    if (request.responseFormat) body.response_format = request.responseFormat;
    if (request.tools?.length) body.tools = request.tools;
    if (request.toolChoice) body.tool_choice = request.toolChoice;
    if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
    if (request.temperature !== undefined) body.temperature = request.temperature;

    const data = await this.call(() => this.http.post(POLZA_PATHS.chatCompletions, body));
    return mapChatCompletion(data);
  }

  public async getBalance(options: IPolzaCallOptions = {}): Promise<IPolzaBalance> {
    this.assertEnabled();
    const { signal, retry = true } = options;
    const data = await this.call(
      () => this.http.get(POLZA_PATHS.balance, signal ? { signal } : undefined),
      retry ? this.retry : NO_RETRY,
    );
    return mapBalance(data);
  }

  public async listModels(): Promise<IPolzaModel[]> {
    this.assertEnabled();
    return mapModels(await this.call(() => this.http.get(POLZA_PATHS.models)));
  }

  private assertEnabled(): void {
    if (!this.enabled) throw new PolzaDisabledError();
  }

  private async call(
    request: () => Promise<{ data: unknown }>,
    retry: IRetryOptions = this.retry,
  ): Promise<unknown> {
    const response = await withPolzaRetry(request, retry, this.sleep, (error, attempt, delay) =>
      this.logger.warn(
        `Polza ${error.status} на ${error.request ?? '?'}: повтор ${attempt} через ${delay} мс`,
      ),
    );
    return response.data;
  }

  private toDomainError(error: AxiosError): PolzaApiError {
    const response = error.response;
    const reason = error.message || error.code || 'сетевой сбой без описания';
    const headers = (response?.headers ?? {}) as Record<string, unknown>;
    const domain = toPolzaApiError(
      response?.status,
      response?.data,
      headers['retry-after'],
      reason,
    ).withRequest(error.config?.method, error.config?.url);

    // Только статус, запрос, code, trace_id и текст. config.headers несёт Bearer.
    this.logger.error(
      `Polza ${response?.status ?? 'нет ответа'} на ${domain.request ?? '?'}` +
        (domain.code ? ` [${domain.code}]` : '') +
        (domain.traceId ? ` trace ${domain.traceId}` : '') +
        `: ${domain.message}`,
    );
    return domain;
  }
}

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const numOrNull = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Сообщение в форме тела OpenAI: snake_case, у ассистента без вызовов поля `tool_calls` нет. */
export function toWireMessage(message: IPolzaMessage): Record<string, unknown> {
  if (message.role === 'tool') {
    return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
  }
  if (message.role === 'assistant' && message.toolCalls?.length) {
    return {
      role: 'assistant',
      content: message.content,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.arguments },
      })),
    };
  }
  return { role: message.role, content: message.content };
}

interface IRawToolCall {
  id?: unknown;
  function?: { name?: unknown; arguments?: unknown };
}

/** Вызовы без имени отбрасываются: исполнить их нечем. Аргументы-объект (бывает у провайдеров) — в строку. */
function mapToolCalls(raw: unknown): IPolzaToolCall[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((call: IRawToolCall): IPolzaToolCall => {
      const args = call?.function?.arguments;
      let text = '';
      if (typeof args === 'string') text = args;
      else if (args) text = JSON.stringify(args);
      return { id: str(call?.id), name: str(call?.function?.name), arguments: text };
    })
    .filter((call) => call.name);
}

/** Разбор ответа chat/completions. Отсутствующие счётчики — 0, а не NaN. */
export function mapChatCompletion(raw: unknown): IChatCompletionResult {
  const data = (raw ?? {}) as {
    id?: unknown;
    model?: unknown;
    provider?: unknown;
    choices?: Array<{
      message?: { content?: unknown; tool_calls?: unknown };
      finish_reason?: unknown;
    }>;
    usage?: {
      prompt_tokens?: unknown;
      completion_tokens?: unknown;
      total_tokens?: unknown;
      cost_rub?: unknown;
      prompt_tokens_details?: { cached_tokens?: unknown };
      completion_tokens_details?: { reasoning_tokens?: unknown };
    };
  };
  const usage = data.usage ?? {};
  const choice = data.choices?.[0];

  return {
    content: str(choice?.message?.content),
    toolCalls: mapToolCalls(choice?.message?.tool_calls),
    finishReason: str(choice?.finish_reason),
    usage: {
      promptTokens: num(usage.prompt_tokens),
      completionTokens: num(usage.completion_tokens),
      totalTokens: num(usage.total_tokens),
      cachedTokens: num(usage.prompt_tokens_details?.cached_tokens),
      reasoningTokens: num(usage.completion_tokens_details?.reasoning_tokens),
      costRub: num(usage.cost_rub),
    },
    model: str(data.model),
    provider: str(data.provider),
    traceId: str(data.id),
  };
}

/** Деньги у Polza — строки с восемью знаками. */
export function mapBalance(raw: unknown): IPolzaBalance {
  const data = (raw ?? {}) as Record<string, unknown>;
  return {
    amount: num(data.amount),
    available: num(data.available),
    reservedAmount: numOrNull(data.reservedAmount),
    spentAmount: numOrNull(data.spentAmount),
    updatedAt: str(data.updatedAt) || null,
  };
}

interface IRawModel {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  context_length?: unknown;
  top_provider?: {
    context_length?: unknown;
    supported_parameters?: unknown;
    pricing?: {
      prompt_per_million?: unknown;
      completion_per_million?: unknown;
      currency?: unknown;
    };
  };
}

function mapModelPricing(raw: IRawModel['top_provider']['pricing']): IPolzaModelPricing | null {
  if (!raw || raw.currency !== 'RUB') return null;
  const prompt = numOrNull(raw.prompt_per_million);
  const completion = numOrNull(raw.completion_per_million);
  if (prompt === null || completion === null) return null;
  return { promptPerMillionRub: prompt, completionPerMillionRub: completion };
}

/** Разбор GET /v1/models. Живая форма — OpenRouter-подобная, цена и параметры лежат в `top_provider`. */
export function mapModels(raw: unknown): IPolzaModel[] {
  const list = (raw as { data?: unknown })?.data ?? raw;
  if (!Array.isArray(list)) return [];
  return list
    .map((m: IRawModel): IPolzaModel => {
      const provider = m?.top_provider;
      const params = Array.isArray(provider?.supported_parameters)
        ? provider.supported_parameters
        : [];
      return {
        id: str(m?.id),
        ...(typeof m?.name === 'string' ? { name: m.name } : {}),
        ...(typeof m?.type === 'string' ? { type: m.type } : {}),
        contextLength: numOrNull(m?.context_length ?? provider?.context_length),
        pricing: mapModelPricing(provider?.pricing),
        structuredOutputs: params.includes('structured_outputs'),
        tools: params.includes('tools'),
      };
    })
    .filter((m) => m.id);
}
