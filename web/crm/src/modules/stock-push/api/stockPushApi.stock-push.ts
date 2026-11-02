import type { PushInterval, PushSchedule, PushScheduleResponse } from '../stock-push.domain';

import { mapPushSchedule } from '../mappers/mapPushSchedule.stock-push';

import { http } from '@/shared/http';

const BASE = '/ym/stock-push/schedule';

/** Ответ записи — свежий вид: после сохранения экран рисуется с сервера. */
export const stockPushApi = {
  getSchedule: async (): Promise<PushSchedule> =>
    mapPushSchedule(await http.get<PushScheduleResponse>(BASE)),

  saveInterval: async (interval: PushInterval): Promise<PushSchedule> =>
    mapPushSchedule(await http.put<PushScheduleResponse>(BASE, { interval })),
};
