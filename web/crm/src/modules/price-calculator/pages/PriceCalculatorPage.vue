<script setup lang="ts">
/**
 * «Калькулятор цен» (TASK-139, ТЗ п.8): прибыль штуки при цене и цена для
 * нужной прибыли или рентабельности. Ставки — факт товара за 30 дней из
 * финжурнала, сверка с тарифом Маркета по магазину и правка руками; у каждой
 * ставки виден источник. Формула — общая с бэкендом, считается мгновенно.
 */
import { RotateCw } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';

import CalcProductPicker from '../components/CalcProductPicker.vue';
import CalcRatesCard from '../components/CalcRatesCard.vue';
import CalcResultCard from '../components/CalcResultCard.vue';
import { formatPercent } from '../mappers/mapCalc.price-calculator';
import {
  CALC_MODE_OPTIONS,
  CALC_PLATFORMS,
  FINANCE_FEATURE,
  NOT_TARIFF_CALC_NOTE,
  TARGET_KIND_OPTIONS,
} from '../price-calculator.domain';
import { usePriceCalculatorStore } from '../store/store.price-calculator';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { OptionGroup } from '@/components/ui/option-group';
import { PageHeader } from '@/components/ui/page-header';
import { RefreshIndicator } from '@/components/ui/refresh-indicator';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthStore } from '@/modules/auth/store/store.auth';
import { useStoresStore } from '@/modules/stores/store/store.stores';
import { formatKopecks, formatMoscowDate } from '@/shared/utils';

const store = usePriceCalculatorStore();
const auth = useAuthStore();
const stores = useStoresStore();
const route = useRoute();
const { data, isRefreshing, savedAt, error, selected, effective, view, tariff } =
  storeToRefs(store);

const ready = computed(() => auth.me !== null);
const withFinance = computed(() => auth.me?.features?.[FINANCE_FEATURE] === true);
const storeOptions = computed(() =>
  (stores.stores ?? []).map((item) => ({ value: item.key, label: item.label })),
);
const windowLabel = computed(() => {
  const window = data.value?.window;
  if (!window) return '';
  const day = (iso: string) => formatMoscowDate(`${iso}T12:00:00+03:00`) ?? iso;
  return `${day(window.from)} — ${day(window.to)}`;
});
const taxLabel = computed(() => {
  const tax = data.value?.tax;
  if (!tax) return '';
  return tax.mode === 'profit'
    ? `${tax.regimeLabel}, не меньше ${formatPercent(tax.minRate)} от продажи`
    : tax.regimeLabel;
});

watch(
  () => ready.value && withFinance.value,
  (ok) => {
    if (ok) store.ensure();
  },
  { immediate: true },
);

// Ссылка из unit-экономики: ?sku= открывает калькулятор сразу с товаром.
watch(
  () => (data.value ? route.query.sku : undefined),
  (sku) => {
    if (typeof sku === 'string' && sku && store.sku !== sku) store.chooseSku(sku);
  },
  { immediate: true },
);

onMounted(() => {
  if (stores.stores === null) void stores.loadList();
});

watch(
  storeOptions,
  (options) => {
    const first = options[0];
    if (store.tariffStore === '' && first) store.setTariffStore(first.value);
  },
  { immediate: true },
);
</script>

<template>
  <PageHeader
    title="Калькулятор цен"
    description="Сколько останется со штуки при цене — и какую цену ставить для нужной прибыли"
  />

  <p class="text-sm text-muted-foreground">{{ NOT_TARIFF_CALC_NOTE }}</p>

  <Alert v-if="ready && !withFinance">
    Ставки берутся из финансового журнала — откройте «Финансы» у администратора.
  </Alert>

  <div v-else-if="error && !data" class="flex flex-col items-start gap-3">
    <Alert>{{ error }}</Alert>
    <Button variant="outline" @click="store.retry()">
      <RotateCw />
      Повторить
    </Button>
  </div>

  <div v-else-if="!data || !effective || !view" class="flex flex-col gap-4" aria-busy="true">
    <p class="text-sm text-muted-foreground">Собираю ставки товаров за 30 дней…</p>
    <Skeleton class="h-48 w-full" />
  </div>

  <div v-else class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <span class="text-sm text-muted-foreground tabular-nums">Факт за {{ windowLabel }}</span>
      <RefreshIndicator
        :refreshing="isRefreshing"
        :saved-at="savedAt"
        :error="error"
        @retry="store.retry()"
      />
    </div>

    <div class="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div class="flex flex-col gap-4">
        <Card class="flex flex-col gap-4 p-4">
          <div class="flex flex-wrap items-center gap-3">
            <OptionGroup
              :model-value="'ym'"
              :options="CALC_PLATFORMS.filter((p) => p.ready)"
              label="Площадка"
            />
            <span class="text-xs text-muted-foreground">
              {{
                CALC_PLATFORMS.filter((p) => !p.ready)
                  .map((p) => p.label)
                  .join(', ')
              }}
            </span>
          </div>

          <section aria-label="Товар" class="flex flex-col gap-2">
            <h2 class="text-sm font-semibold">Товар</h2>
            <CalcProductPicker
              :skus="data.skus"
              :selected="selected"
              @choose="store.chooseSku($event)"
            />
          </section>

          <OptionGroup
            :model-value="store.mode"
            :options="CALC_MODE_OPTIONS"
            label="Что считаем"
            @update:model-value="store.setMode($event)"
          />

          <div class="grid gap-3 sm:grid-cols-2">
            <FormField v-if="store.mode === 'profit'" id="calc-price" label="Цена, ₽">
              <template #default="{ attrs }">
                <Input
                  v-bind="attrs"
                  :model-value="store.priceText"
                  inputmode="decimal"
                  class="tabular-nums"
                  @update:model-value="store.setPriceText(String($event))"
                />
              </template>
            </FormField>
            <div v-else class="flex flex-col gap-2">
              <OptionGroup
                :model-value="store.targetKind"
                :options="TARGET_KIND_OPTIONS"
                label="Цель"
                @update:model-value="store.setTargetKind($event)"
              />
              <Input
                :model-value="store.targetText"
                inputmode="decimal"
                class="tabular-nums"
                :aria-label="
                  store.targetKind === 'rub' ? 'Прибыль со штуки, ₽' : 'Рентабельность, %'
                "
                :placeholder="store.targetKind === 'rub' ? 'например, 700' : 'например, 20'"
                @update:model-value="store.setTargetText(String($event))"
              />
            </div>
            <FormField id="calc-discount" label="Скидка, %">
              <template #default="{ attrs }">
                <Input
                  v-bind="attrs"
                  :model-value="store.discountText"
                  inputmode="decimal"
                  placeholder="0"
                  class="tabular-nums"
                  @update:model-value="store.setDiscountText(String($event))"
                />
              </template>
            </FormField>
          </div>
        </Card>

        <Card class="flex flex-col gap-2 p-4">
          <h2 class="text-sm font-semibold">Ставки</h2>
          <CalcRatesCard
            :rates="effective"
            :overridden="store.overrides"
            :source-labels="data.sourceLabels"
            :tax-label="taxLabel"
            @set="(key, text) => store.setOverride(key, text)"
            @clear="store.clearOverride($event)"
          />

          <div v-if="selected" class="flex flex-col gap-2 border-t pt-3">
            <div class="flex flex-wrap items-center gap-2">
              <OptionGroup
                v-if="storeOptions.length > 1"
                :model-value="store.tariffStore"
                :options="storeOptions"
                label="Магазин для тарифа"
                @update:model-value="store.setTariffStore($event)"
              />
              <Button
                size="sm"
                variant="outline"
                :disabled="store.tariffLoading || store.tariffStore === ''"
                @click="store.checkTariff()"
              >
                {{ store.tariffLoading ? 'Спрашиваю тариф…' : 'Сверить с тарифом ЯМ' }}
              </Button>
            </div>
            <p v-if="store.tariffError" class="text-sm text-danger">{{ store.tariffError }}</p>
            <p v-if="tariff" class="text-xs text-muted-foreground">
              Тариф Маркета при цене {{ formatKopecks(tariff.priceKopecks) }}:
              {{ tariff.services.map((s) => `${s.label} ${formatKopecks(s.kopecks)}`).join(', ') }}.
              Комиссия и логистика подставлены с меткой «тариф ЯМ»; расчёт Маркета примерный.
            </p>
          </div>
        </Card>
      </div>

      <Card class="h-fit p-4 lg:sticky lg:top-4">
        <CalcResultCard :view="view" :mode="store.mode" />
      </Card>
    </div>
  </div>
</template>
