<script setup lang="ts">
/**
 * Продвижение по брендам: что сейчас начисляется и кнопки правки. Правка —
 * диалогом одной формой (в боте это пошаговые вопросы), отключение — через
 * подтверждение.
 */
import type { BrandPromotion } from '../settings.domain';

import { usePromoDialog } from '../composables/usePromoDialog.settings';

import PromoDialog from './PromoDialog.vue';

import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

defineProps<{ promotion: BrandPromotion[] }>();

const dialog = usePromoDialog();
const { brand, open, confirmOff, form, errors, busy } = dialog;
</script>

<template>
  <Card class="p-0">
    <CardHeader>
      <CardTitle>Продвижение</CardTitle>
      <CardDescription>
        Процент от цены продажи, который Маркет берёт за продвижение бренда. Вычитается в «Прибыли».
      </CardDescription>
    </CardHeader>
    <Table v-if="promotion.length">
      <TableHeader>
        <TableRow>
          <TableHead>Бренд</TableHead>
          <TableHead>Продвижение</TableHead>
          <TableHead aria-label="Действия" />
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="item in promotion" :key="item.key">
          <TableCell>{{ item.title }}</TableCell>
          <TableCell class="tnum">{{ item.label }}</TableCell>
          <TableCell class="text-right">
            <Button variant="ghost" size="sm" @click="dialog.edit(item)">Настроить</Button>
            <Button v-if="item.config" variant="ghost" size="sm" @click="dialog.askDisable(item)">
              Отключить
            </Button>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
    <CardDescription v-else class="px-6 pb-6">
      Бренды появятся после загрузки прайса.
    </CardDescription>
  </Card>

  <PromoDialog
    v-if="brand"
    v-model:open="open"
    v-model:form="form"
    :title="`Продвижение «${brand.title}»`"
    :errors="errors"
    :busy="busy"
    @save="dialog.save()"
  />

  <ConfirmDialog
    v-model:open="confirmOff"
    :title="`Отключить продвижение «${brand?.title ?? ''}»?`"
    description="Комиссия за продвижение перестанет вычитаться в «Прибыли»."
    confirm-label="Отключить"
    destructive
    :busy="busy"
    @confirm="dialog.disable()"
  />
</template>
