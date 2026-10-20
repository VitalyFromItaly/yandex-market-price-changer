import type { JobStartResponse, JobView } from './jobs.domain';
import type { DownloadedFile } from '@/shared/http';

import { http } from '@/shared/http';

const JOBS_PATH = '/ym/jobs';

export const jobsApi = {
  /** `store` — ключ магазина из адреса: отчёт считается по нему, а не по активному в боте. */
  start: (
    kind: string,
    params: Record<string, unknown> = {},
    store?: string,
  ): Promise<JobStartResponse> => http.post<JobStartResponse>(JOBS_PATH, { kind, params, store }),

  get: <TData>(jobId: string): Promise<JobView<TData>> =>
    http.get<JobView<TData>>(`${JOBS_PATH}/${encodeURIComponent(jobId)}`),

  file: (jobId: string): Promise<DownloadedFile> =>
    http.file(`${JOBS_PATH}/${encodeURIComponent(jobId)}/file`),
};

/** Отдать файл браузеру на сохранение. Ссылка живёт ровно один клик. */
export function saveFile(file: DownloadedFile, fallbackName: string): void {
  const url = URL.createObjectURL(file.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.filename ?? fallbackName;
  link.click();
  URL.revokeObjectURL(url);
}
