import type { PaymentsOptions, PaymentsOptionsResponse } from '../payments.domain';

import { mapPaymentsOptions } from '../mappers/mapPayments.payments';

import { http } from '@/shared/http';

export const paymentsApi = {
  /** Варианты формы — из констант домена бота; сам отчёт идёт фоновой задачей. */
  options: async (): Promise<PaymentsOptions> =>
    mapPaymentsOptions(await http.get<PaymentsOptionsResponse>('/ym/payments/options')),
};
