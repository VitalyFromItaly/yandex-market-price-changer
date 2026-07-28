export const QUEUE_NAMES = {
  FILE_PROCESSING: 'file-processing',
  YANDEX_API: 'yandex-api',
  NOTIFICATIONS: 'notifications',
} as const;

export const JOB_TYPES = {
  PROCESS_FILE: 'process-file',
  PARSE_FILE: 'parse-file',
  COMPARE_DATA: 'compare-data',
  FETCH_YANDEX_DATA: 'fetch-yandex-data',
  UPDATE_YANDEX_OFFERS: 'update-yandex-offers',
  SEND_PROGRESS: 'send-progress',
  SEND_COMPLETION: 'send-completion',
  SEND_ERROR: 'send-error',
} as const;
