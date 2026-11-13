<script setup lang="ts">
/**
 * Отчёт кабинета WB «Продвижение» файлом (TASK-209): списания за рекламу по
 * кампаниям ложатся в журнал справочной строкой. В прибыль они не входят — у
 * WB реклама уже внутри удержаний (решение accounting_upload_reference_only).
 * Месяц — выбор продавца: текущий или один из двенадцати прошлых.
 */
import { Upload } from 'lucide-vue-next';
import { computed, ref } from 'vue';

import { useAccountingStore } from '../store/store.accounting';

import ReconcileMonthPicker from './ReconcileMonthPicker.vue';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FileInput } from '@/components/ui/file-input';
import { FormField } from '@/components/ui/form-field';
import { FINANCE_UPLOAD_ACCEPT } from '@/modules/finance/constants/upload.finance';
import { monthLabel, moscowTodayIso, recentMonths } from '@/shared/period';

const store = useAccountingStore();

const options = recentMonths(moscowTodayIso(), 13).map((value) => ({
  value,
  label: monthLabel(value),
}));
// По умолчанию — прошлый месяц: отчёт обычно выгружают за закрытый.
const month = ref<string>(options[1]?.value ?? moscowTodayIso().slice(0, 7));
const label = computed(() => options.find((o) => o.value === month.value)?.label ?? month.value);

const file = ref<File | null>(null);

function pick(next: File | null): void {
  file.value = next;
  store.clearWbPromotionFileError();
}

function submit(): void {
  if (file.value !== null) void store.uploadWbPromotion(file.value, month.value);
}
</script>

<template>
  <Card>
    <CardHeader>
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div class="flex flex-col gap-1.5">
          <CardTitle>Реклама WB файлом</CardTitle>
          <CardDescription>
            Скачайте в кабинете WB отчёт «Продвижение» о списаниях и загрузите его сюда — расходы по
            кампаниям лягут в учёт за {{ label.toLowerCase() }}. Справочно: в прибыль они не входят,
            у WB реклама уже в удержаниях. Повторы не задваиваются.
          </CardDescription>
        </div>
        <ReconcileMonthPicker
          v-model="month"
          :options="options"
          :label="label"
          :disabled="store.wbPromotionUploading"
          aria-label="Месяц отчёта"
        />
      </div>
    </CardHeader>
    <CardContent class="flex flex-col gap-4">
      <FormField id="wb-promotion-file" label="Файл" :error="store.wbPromotionErrors.file">
        <template #default="{ attrs }">
          <FileInput
            v-bind="attrs"
            :model-value="file"
            :accept="FINANCE_UPLOAD_ACCEPT"
            :disabled="store.wbPromotionUploading"
            hint="Excel (.xlsx, .xls) или CSV, до 15 МБ"
            @update:model-value="pick"
          />
        </template>
      </FormField>
      <Alert v-if="store.wbPromotionErrors.missing.length" variant="warn">
        Не нашли колонки: {{ store.wbPromotionErrors.missing.join(', ') }}. Проверьте, что это отчёт
        «Продвижение», а не другой отчёт кабинета.
      </Alert>
      <Alert v-if="store.wbPromotionErrors.form">{{ store.wbPromotionErrors.form }}</Alert>
      <div>
        <Button :disabled="file === null || store.wbPromotionUploading" @click="submit">
          <Upload />
          {{ store.wbPromotionUploading ? 'Загружаю…' : 'Загрузить' }}
        </Button>
      </div>
      <div
        v-if="store.wbPromotionSummary"
        class="rounded-md border border-border p-3 text-sm"
        role="status"
      >
        <p class="font-medium">{{ store.wbPromotionSummary.title }}</p>
        <p v-for="line in store.wbPromotionSummary.lines" :key="line" class="text-muted-foreground">
          {{ line }}
        </p>
      </div>
    </CardContent>
  </Card>
</template>
