<script setup lang="ts">
import { Construction } from 'lucide-vue-next';
import { computed } from 'vue';
import { RouterLink } from 'vue-router';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { ALL_MARKETPLACES } from '@/navigation';
import { sectionPath } from '@/navigation.sections';
import { useMarketplace } from '@/shared/composables';

/**
 * Площадка «скоро» у продавца (Ozon, Wildberries без открытой фичи — гард
 * `useMarketplaceGuard` ведёт сюда любой её адрес). Говорит честно: подключение скоро.
 */
const marketplace = useMarketplace();
const label = computed(
  () => ALL_MARKETPLACES.find((m) => m.key === marketplace.value)?.label ?? 'Площадка',
);
const home = sectionPath('ym', 'stores');
</script>

<template>
  <PageHeader
    :title="label"
    description="Финансы, товары и заказы — в одном кабинете с Яндекс Маркетом"
  >
    <template #actions>
      <Button as-child variant="outline">
        <RouterLink :to="home">К Яндекс Маркету</RouterLink>
      </Button>
    </template>
  </PageHeader>
  <EmptyState
    :icon="Construction"
    :title="`Подключение ${label} скоро появится`"
    description="Когда площадка будет подключена, её заказы, товары и финансы лягут в те же отчёты, что и у Яндекс Маркета."
  />
</template>
