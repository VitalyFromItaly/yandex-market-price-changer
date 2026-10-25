import type { JournalMarketplace, JournalMonth } from './financeJournal.domain';

import { computed, getCurrentScope, onScopeDispose, ref, watch } from 'vue';

import {
  FINANCE_FEATURE,
  FINANCE_PULL_FEATURE,
  PULL_POLL_MS,
  PULL_TIMEOUT_MS,
  cooldownText,
  coverageOf,
  monthsOfRange,
  pullDone,
  refreshableOf,
} from './financeJournal.domain';
import { financeJournalApi } from './financeJournalApi';

import { useAuthStore } from '@/modules/auth/store/store.auth';
import { ApiError } from '@/shared/http';
import { moscowTodayIso, recentMonths } from '@/shared/period';

export interface JournalSource {
  marketplace: JournalMarketplace;
  from: string;
  to: string;
}

export const PULL_TIMEOUT_TEXT =
  'Маркет всё ещё готовит отчёт. Загрузка доделается сама — обновите страницу через несколько минут.';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Состояние журнала за период экрана и кнопка «Загрузить из Маркета».
 *
 * `source` — площадка и период экрана (null — экран ещё не знает период);
 * `onLoaded` — перечитать экран, когда загрузка закончилась. Месяцы журнала
 * спрашиваются у `GET /ym/finance/months` только при открытой `finance`: без неё
 * журнал экрану не положен вовсе. Сбой этого запроса экран не ломает — просто
 * не говорим о журнале. Опрос после кнопки — по смене `checkedAt` поставленных
 * месяцев (сравнение с собой, часы браузера и сервера не сравниваются) и
 * останавливается вместе с областью компонента.
 */
export function useFinanceJournal(source: () => JournalSource | null, onLoaded: () => void) {
  const auth = useAuthStore();
  const features = computed(() => auth.me?.features ?? {});
  const enabled = computed(() => features.value[FINANCE_FEATURE] === true);
  const canPull = computed(() => enabled.value && features.value[FINANCE_PULL_FEATURE] === true);

  const months = ref<JournalMonth[] | null>(null);
  const pulling = ref(false);
  const notice = ref<string | null>(null);
  const error = ref<string | null>(null);
  let generation = 0;

  const wanted = computed(() => {
    const s = source();
    return s ? monthsOfRange(s.from, s.to) : [];
  });
  const coverage = computed(() =>
    months.value === null ? null : coverageOf(months.value, wanted.value),
  );
  const missing = computed(() => coverage.value?.missing ?? []);
  /** Что обновит «Обновить» у загруженного периода. */
  const refreshable = computed(() => refreshableOf(wanted.value, recentMonths(moscowTodayIso())));

  async function refresh(): Promise<void> {
    const s = source();
    if (!s || !enabled.value) {
      months.value = null;
      return;
    }
    const current = generation;
    try {
      const next = await financeJournalApi.months(s.marketplace);
      if (current === generation) months.value = next;
    } catch {
      // Экран важнее подписи о журнале: молчим, а не роняем его.
      if (current === generation) months.value = null;
    }
  }

  /** Загрузить месяцы без журнала, а если все есть — обновить открытые. */
  async function pull(): Promise<void> {
    const s = source();
    if (!s || !canPull.value || pulling.value) return;
    const targets = missing.value.length ? missing.value : refreshable.value;
    if (!targets.length) return;
    const current = ++generation;
    notice.value = null;
    error.value = null;
    pulling.value = true;
    try {
      const before = Object.fromEntries(
        targets.map((month) => [
          month,
          months.value?.find((m) => m.month === month)?.checkedAt ?? null,
        ]),
      );
      const result = await financeJournalApi.pull(s.marketplace, targets);
      if (current !== generation) return;
      if (result.cooldown.length) notice.value = cooldownText(result.cooldown);
      if (!result.queued.length) return;

      const waiting = Object.fromEntries(
        result.queued.map((month) => [month, before[month] ?? null]),
      );
      const deadline = Date.now() + PULL_TIMEOUT_MS;
      for (;;) {
        await sleep(PULL_POLL_MS);
        if (current !== generation) return;
        let next: JournalMonth[];
        try {
          next = await financeJournalApi.months(s.marketplace);
        } catch {
          next = months.value ?? [];
        }
        if (current !== generation) return;
        months.value = next;
        if (pullDone(waiting, next)) break;
        if (Date.now() > deadline) {
          notice.value = PULL_TIMEOUT_TEXT;
          return;
        }
      }
      onLoaded();
    } catch (e) {
      if (current === generation) {
        error.value = e instanceof ApiError || e instanceof Error ? e.message : String(e);
      }
    } finally {
      if (current === generation) pulling.value = false;
    }
  }

  watch(
    () => {
      const s = source();
      return s && enabled.value ? `${s.marketplace}:${s.from}:${s.to}` : null;
    },
    (key, previous) => {
      // Другой экран периода: прежний опрос и подписи — не о нём.
      if (key !== previous) {
        generation++;
        pulling.value = false;
        notice.value = null;
        error.value = null;
      }
      void refresh();
    },
    { immediate: true },
  );

  if (getCurrentScope()) {
    onScopeDispose(() => {
      generation++;
    });
  }

  return {
    marketplace: computed(() => source()?.marketplace ?? 'ym'),
    enabled,
    canPull,
    months,
    coverage,
    missing,
    refreshable,
    pulling,
    notice,
    error,
    pull,
    refresh,
  };
}

export type FinanceJournal = ReturnType<typeof useFinanceJournal>;
