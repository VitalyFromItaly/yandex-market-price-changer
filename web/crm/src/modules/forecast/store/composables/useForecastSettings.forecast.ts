import type { BasisDays } from '../../forecast.domain';

import { DEFAULT_BASIS_DAYS, DEFAULT_COVER_DAYS } from '../../forecast.domain';

import { useBaseState } from '@/shared/composables';

/**
 * Настройки экрана: окно базы прогноза (решение `forecast_basis_selectable`),
 * дни запаса закупок и поправка комиссии для what-if.
 */
export function useForecastSettings() {
  const [basisDays, setBasisDays, , resetBasis] = useBaseState<BasisDays>(DEFAULT_BASIS_DAYS);
  const [coverDays, setCoverDays, , resetCover] = useBaseState<number>(DEFAULT_COVER_DAYS);
  const [whatIfPp, setWhatIfPp, , resetWhatIf] = useBaseState<number>(0);

  function reset(): void {
    resetBasis();
    resetCover();
    resetWhatIf();
  }

  return { basisDays, setBasisDays, coverDays, setCoverDays, whatIfPp, setWhatIfPp, reset };
}
