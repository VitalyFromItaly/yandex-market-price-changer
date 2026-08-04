export const QUEUE_NAMES = {
  FILE_PROCESSING: 'file-processing',
  YANDEX_API: 'yandex-api',
  NOTIFICATIONS: 'notifications',
  REPORTS: 'reports',
} as const;

export const JOB_TYPES = {
  /**
   * Живая загрузка прайса: одна джоба «скачать → разобрать → записать» в
   * очереди file-processing. НЕ часть мёртвого 4-хопового конвейера ниже.
   */
  SYNC_STOCKS: 'sync-stocks',
  PROCESS_FILE: 'process-file',
  PARSE_FILE: 'parse-file',
  COMPARE_DATA: 'compare-data',
  FETCH_YANDEX_DATA: 'fetch-yandex-data',
  UPDATE_YANDEX_OFFERS: 'update-yandex-offers',
  SEND_PROGRESS: 'send-progress',
  SEND_COMPLETION: 'send-completion',
  SEND_ERROR: 'send-error',
  SEND_SCHEDULED_REPORT: 'send-scheduled-report',
} as const;
