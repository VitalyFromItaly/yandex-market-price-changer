import type { ICrmJobKind } from './crm-jobs.domain';

import { Injectable } from '@nestjs/common';

/**
 * Какие фоновые задачи умеет CRM. Модуль фичи регистрирует свой kind в
 * `onModuleInit` и зовёт в `run` те же сервисы, что процессоры бота, — логика
 * одна, отличается только доставка. Неизвестный kind контроллер отвергает до
 * постановки в очередь.
 */
@Injectable()
export class CrmJobsRegistry {
  private readonly kinds = new Map<string, ICrmJobKind>();

  register(kind: string, definition: ICrmJobKind): void {
    if (this.kinds.has(kind)) throw new Error(`kind «${kind}» уже зарегистрирован`);
    this.kinds.set(kind, definition);
  }

  get(kind: string): ICrmJobKind | undefined {
    return this.kinds.get(kind);
  }
}
