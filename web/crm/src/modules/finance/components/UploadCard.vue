<script setup lang="ts">
/**
 * Ручная загрузка отчёта по платежам (TASK-114): файл из кабинета Маркета
 * ложится в журнал выбранного месяца. Только добавляет — ничего из
 * загруженного Маркетом не снимает (решение finance_upload_append_only).
 */
import type { FinanceUploadErrors, FinanceUploadSummary } from '../finance.domain';

import { Upload } from 'lucide-vue-next';
import { ref } from 'vue';

import { FINANCE_UPLOAD_ACCEPT } from '../constants/upload.finance';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FileInput } from '@/components/ui/file-input';
import { FormField } from '@/components/ui/form-field';

defineProps<{
  monthLabel: string | null;
  summary: FinanceUploadSummary | null;
  errors: FinanceUploadErrors;
  uploading: boolean;
}>();
const emit = defineEmits<{ upload: [file: File]; 'clear-file-error': [] }>();

const file = ref<File | null>(null);

function pick(next: File | null): void {
  file.value = next;
  emit('clear-file-error');
}

function submit(): void {
  if (file.value !== null) emit('upload', file.value);
}
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Отчёт по платежам файлом</CardTitle>
      <CardDescription>
        Если отчёт не пришёл через API, скачайте в кабинете Маркета «Отчёт по платежам» и загрузите
        его сюда{{ monthLabel ? ` — операции лягут в журнал за ${monthLabel.toLowerCase()}` : '' }}.
        Повторы не задваиваются, загруженное Маркетом не снимается.
      </CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-4">
      <FormField id="finance-upload-file" label="Файл" :error="errors.file">
        <template #default="{ attrs }">
          <FileInput
            v-bind="attrs"
            :model-value="file"
            :accept="FINANCE_UPLOAD_ACCEPT"
            :disabled="uploading"
            hint="Excel (.xlsx, .xls) или CSV, до 15 МБ"
            @update:model-value="pick"
          />
        </template>
      </FormField>
      <Alert v-if="errors.missing.length" variant="warn">
        Не нашли колонки: {{ errors.missing.join(', ') }}. Проверьте, что это отчёт по платежам, а
        не другой отчёт кабинета.
      </Alert>
      <Alert v-if="errors.form">{{ errors.form }}</Alert>
      <div>
        <Button :disabled="file === null || uploading || monthLabel === null" @click="submit">
          <Upload />
          {{ uploading ? 'Загружаю…' : 'Загрузить' }}
        </Button>
      </div>
      <div v-if="summary" class="rounded-md border border-border p-3 text-sm" role="status">
        <p class="font-medium">{{ summary.title }}</p>
        <p v-for="line in summary.lines" :key="line" class="text-muted-foreground">{{ line }}</p>
      </div>
    </CardContent>
  </Card>
</template>
