import type {
  ManualOperation,
  ManualOperationChange,
  ManualOperationErrors,
  ManualOperationForm,
} from '../accounting.domain';

import { computed, ref } from 'vue';

import { accountingApi } from '../api/accountingApi.accounting';
import {
  manualBody,
  mapManualError,
  newClientKey,
  toManualForm,
} from '../mappers/mapManualOperations.accounting';
import { useAccountingStore } from '../store/store.accounting';

import { toast } from '@/components/ui/toast';
import { moscowToday } from '@/shared/utils';

/**
 * Диалог ручной операции: новая или правка — одна форма. Ключ формы заводится
 * при открытии «новой» и уходит с каждой отправкой: двойной клик или повтор
 * после обрыва находят ту же операцию, а не заводят вторую. Проверяет сервер,
 * ошибка встаёт под своё поле; диалог закрывается только после удачной записи.
 */
export function useManualOperationDialog(today: () => string = () => moscowToday()) {
  const store = useAccountingStore();

  const open = ref(false);
  const editing = ref<ManualOperation | null>(null);
  const form = ref<ManualOperationForm>(toManualForm(null, today()));
  const errors = ref<ManualOperationErrors>({});
  const busy = ref(false);
  const clientKey = ref(newClientKey());

  const title = computed(() =>
    editing.value === null ? 'Новая ручная операция' : 'Изменить операцию',
  );

  function show(operation: ManualOperation | null): void {
    editing.value = operation;
    form.value = toManualForm(operation, today());
    errors.value = {};
    clientKey.value = newClientKey();
    open.value = true;
  }

  const openCreate = () => show(null);
  const openEdit = (operation: ManualOperation) => show(operation);

  async function save(): Promise<void> {
    if (busy.value) return;
    busy.value = true;
    errors.value = {};
    const target = editing.value;
    try {
      if (target === null) await store.createManual(manualBody(form.value, clientKey.value));
      else await store.updateManual(target.id, manualBody(form.value));
      open.value = false;
      toast.success('Сохранено', target === null ? 'Операция внесена' : 'Операция изменена');
    } catch (e) {
      errors.value = mapManualError(e, 'Не удалось сохранить операцию');
    } finally {
      busy.value = false;
    }
  }

  return { open, editing, form, errors, busy, title, clientKey, openCreate, openEdit, save };
}

/** Удаление с подтверждением: операция уходит из списка, история остаётся. */
export function useManualOperationRemoval() {
  const store = useAccountingStore();
  const target = ref<ManualOperation | null>(null);
  const open = ref(false);
  const busy = ref(false);

  function ask(operation: ManualOperation): void {
    target.value = operation;
    open.value = true;
  }

  async function confirm(): Promise<void> {
    const operation = target.value;
    if (!operation || busy.value) return;
    busy.value = true;
    try {
      await store.removeManual(operation.id);
      open.value = false;
      toast.success('Удалено', 'Операция удалена, её история сохранена');
    } catch (e) {
      toast.error('Не удалось удалить', e instanceof Error ? e.message : undefined);
    } finally {
      busy.value = false;
    }
  }

  return { target, open, busy, ask, confirm };
}

/** История изменений операции — было/стало, кто и когда. */
export function useManualOperationHistory() {
  const open = ref(false);
  const items = ref<ManualOperationChange[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function show(operation: ManualOperation): Promise<void> {
    open.value = true;
    loading.value = true;
    error.value = null;
    items.value = [];
    try {
      items.value = (await accountingApi.manualHistory(operation.id)).items;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Не удалось загрузить историю';
    } finally {
      loading.value = false;
    }
  }

  return { open, items, loading, error, show };
}
