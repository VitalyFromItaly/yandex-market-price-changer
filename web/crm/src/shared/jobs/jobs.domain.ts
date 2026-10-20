/** Фоновая задача CRM: /api/crm/ym/jobs. Статусы — те же, что в CrmJobResult. */
export type JobStatus = 'queued' | 'active' | 'done' | 'failed';

export interface JobStartResponse {
  jobId: string;
  /** false — такая задача уже шла, вернулся её id. */
  created: boolean;
}

export interface JobView<TData = unknown> {
  jobId: string;
  kind: string;
  status: JobStatus;
  data: TData | null;
  error: string | null;
  file: { filename: string } | null;
}

export function isFinished(status: JobStatus): boolean {
  return status === 'done' || status === 'failed';
}
