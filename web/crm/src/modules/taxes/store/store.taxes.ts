import type { TaxReconciliationBody, TaxYearPeriodKey } from '../taxes.domain';

import { defineStore } from 'pinia';

import { taxesApi } from '../api/taxesApi.taxes';

import { useTaxReductions } from './composables/useTaxReductions.taxes';
import { useTaxSettings } from './composables/useTaxSettings.taxes';
import { useTaxYear } from './composables/useTaxYear.taxes';

/** Стор раздела «Налоги» — фасад над настройками и вкладкой «Год» (TASK-146). */
export const useTaxesStore = defineStore('taxes', () => {
  const settings = useTaxSettings();
  const year = useTaxYear();
  const reductions = useTaxReductions();

  /** Уменьшение меняет авансы года — после записи год пересчитывается. */
  async function saveReduction(
    ...args: Parameters<typeof reductions.saveReduction>
  ): Promise<void> {
    await reductions.saveReduction(...args);
    year.loadYear();
  }

  async function removeReduction(id: string): Promise<void> {
    await reductions.removeReduction(id);
    year.loadYear();
  }

  /** Сверка периода; ошибка пробрасывается в диалог. */
  async function reconcile(period: TaxYearPeriodKey, body: TaxReconciliationBody): Promise<void> {
    await taxesApi.reconcile(year.year.value, period, body);
    year.loadYear();
  }

  return {
    ...settings,
    ...year,
    ...reductions,
    saveReduction,
    removeReduction,
    reconcile,
    reset() {
      settings.reset();
      year.resetYear();
      reductions.resetReductions();
    },
  };
});
