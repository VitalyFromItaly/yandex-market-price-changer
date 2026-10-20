import type { BrandPromotion, PromoForm, SettingsErrors } from '../settings.domain';

import { ref } from 'vue';

import { mapSettingsError, promoBody, toPromoForm } from '../mappers/mapSettings.settings';
import { useSettingsStore } from '../store/store.settings';

import { toast } from '@/components/ui/toast';

/**
 * Диалог продвижения одного бренда: режим, проценты, нижний порог — одной
 * формой вместо пошагового диалога бота. Отключение — через подтверждение.
 */
export function usePromoDialog() {
  const store = useSettingsStore();

  const brand = ref<BrandPromotion | null>(null);
  const open = ref(false);
  const confirmOff = ref(false);
  const form = ref<PromoForm>(toPromoForm(null));
  const errors = ref<SettingsErrors>({});
  const busy = ref(false);

  function edit(target: BrandPromotion): void {
    brand.value = target;
    form.value = toPromoForm(target.config);
    errors.value = {};
    open.value = true;
  }

  async function save(): Promise<void> {
    const target = brand.value;
    if (target === null) return;

    busy.value = true;
    errors.value = {};
    try {
      await store.savePromotion(target.key, promoBody(form.value));
      open.value = false;
      toast.success('Сохранено', `Продвижение «${target.title}»`);
    } catch (e) {
      errors.value = mapSettingsError(e, 'Не удалось сохранить продвижение');
    } finally {
      busy.value = false;
    }
  }

  function askDisable(target: BrandPromotion): void {
    brand.value = target;
    confirmOff.value = true;
  }

  async function disable(): Promise<void> {
    const target = brand.value;
    if (target === null) return;

    busy.value = true;
    try {
      await store.disablePromotion(target.key);
      toast.success('Отключено', `Продвижение «${target.title}» не начисляется`);
    } catch (e) {
      toast.error('Не удалось отключить', e instanceof Error ? e.message : undefined);
    } finally {
      busy.value = false;
      confirmOff.value = false;
    }
  }

  return { brand, open, confirmOff, form, errors, busy, edit, save, askDisable, disable };
}
