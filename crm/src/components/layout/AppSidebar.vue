<script setup lang="ts">
import { LogOut, X } from 'lucide-vue-next';
import { computed } from 'vue';

import MarketplaceSwitcher from './MarketplaceSwitcher.vue';
import ThemeToggle from './ThemeToggle.vue';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useLogout } from '@/modules/auth/composables/useLogout.auth';
import { displayNameOf } from '@/modules/auth/mappers/mapMe.auth';
import { useAuthStore } from '@/modules/auth/store/store.auth';
import { useStoresStore } from '@/modules/stores/store/store.stores';
import { sidebarGroups } from '@/navigation';

/*
 * Сайдбар — цвета канваса, отделён только границей (довод админки: разный фон
 * режет один инструмент на «мир меню» и «мир контента»). Активный пункт —
 * заливка поверхности и черта 2px цвета бренда (красный Маркета); это
 * единственный цвет в хроме, кроме знака в шапке.
 */
const emit = defineEmits<{ close: [] }>();

const auth = useAuthStore();
const { logout } = useLogout();
const who = computed(() => (auth.me === null ? null : displayNameOf(auth.me)));

const stores = useStoresStore();

/*
 * Закрытые администратором разделы в меню не попадают. Разделы аккаунта — из
 * /auth/me; сверху — разделы последнего открытого магазина из его вида (по ЕГО
 * модели), подписанные его именем: видно, чьи это отчёты.
 */
const groups = computed(() => sidebarGroups(auth.me?.sections ?? null, stores.current));

/*
 * Пункт с пустым путём — корень магазина («Главная»). Для такой ссылки Vue
 * Router считает активным РОДИТЕЛЯ, и `isActive` горит на любой странице
 * магазина — в меню выделены два пункта. Ему нужно точное совпадение.
 * Остальным — обычное: у разделов со вкладками в адресе параметр
 * (`/profit/:tab`), и точное совпадение гасило бы их на любой вкладке.
 */
const isCurrent = (path: string, active: boolean, exactActive: boolean): boolean =>
  path === '' ? exactActive : active;

const linkClass = (active: boolean): string =>
  cn(
    'relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4',
    active
      ? 'bg-muted font-medium text-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-brand'
      : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
  );
</script>

<template>
  <aside class="flex flex-col gap-4 border-r bg-background p-3">
    <div class="flex items-center justify-between gap-2">
      <MarketplaceSwitcher class="flex-1" />
      <Button
        variant="ghost"
        size="icon"
        class="md:hidden"
        aria-label="Закрыть меню"
        @click="emit('close')"
      >
        <X />
      </Button>
    </div>

    <nav class="flex flex-1 flex-col gap-4" aria-label="Разделы">
      <ul
        v-for="section in groups"
        :key="section.key"
        class="flex flex-col gap-0.5 last:mt-auto"
        :aria-label="section.title ?? undefined"
      >
        <li
          v-if="section.title"
          class="truncate px-3 pb-1 text-xs font-medium text-muted-foreground"
        >
          {{ section.title }}
        </li>
        <li v-for="item in section.items" :key="item.name">
          <!-- По имени; ключ магазина — явно, вне магазина его нет в адресе. -->
          <RouterLink
            v-slot="{ href, navigate, isActive, isExactActive }"
            :to="{ name: item.name, params: section.params }"
            custom
          >
            <a
              :href="href"
              :class="linkClass(isCurrent(item.path, isActive, isExactActive))"
              :aria-current="isCurrent(item.path, isActive, isExactActive) ? 'page' : undefined"
              @click="navigate"
            >
              <component :is="item.icon" aria-hidden="true" />
              {{ item.label }}
            </a>
          </RouterLink>
        </li>
      </ul>
    </nav>

    <div class="flex flex-col gap-2 border-t pt-3">
      <div class="flex items-center justify-between gap-2 px-3">
        <span class="text-xs text-muted-foreground">Тема</span>
        <ThemeToggle />
      </div>
      <div class="flex items-center justify-between gap-2">
        <span class="min-w-0 truncate px-3 text-sm text-muted-foreground">{{ who }}</span>
        <Button variant="ghost" size="sm" @click="logout">
          <LogOut aria-hidden="true" />
          Выйти
        </Button>
      </div>
    </div>
  </aside>
</template>
