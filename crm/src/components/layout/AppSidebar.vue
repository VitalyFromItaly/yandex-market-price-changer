<script setup lang="ts">
import { LogOut, PanelLeftClose, PanelLeftOpen, X } from 'lucide-vue-next';
import { computed } from 'vue';

import BrandMark from './BrandMark.vue';
import MarketplaceSwitcher from './MarketplaceSwitcher.vue';
import ThemeToggle from './ThemeToggle.vue';

import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
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
/*
 * Свёрнутый вид (только md+): иконки пунктов, название — тултипом справа.
 * Всё, что прячется, прячется `md:`-классами: на телефоне меню выезжает
 * целиком, даже если на десктопе его свернули.
 */
const props = defineProps<{ collapsed?: boolean }>();
const emit = defineEmits<{ close: []; toggle: [] }>();
/** Скрыть на десктопе в свёрнутом виде. */
const hideCollapsed = computed(() => (props.collapsed ? 'md:hidden' : ''));

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
    props.collapsed && 'md:justify-center md:px-0',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4',
    active
      ? 'bg-muted font-medium text-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-brand'
      : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
  );
</script>

<template>
  <aside class="flex flex-col gap-4 overflow-hidden border-r bg-background p-3">
    <div class="flex items-center justify-between gap-2">
      <MarketplaceSwitcher :class="['flex-1', hideCollapsed]" />
      <span
        v-if="collapsed"
        class="hidden h-11 w-full items-center justify-center md:flex"
        aria-hidden="true"
      >
        <BrandMark />
      </span>
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
          :class="['truncate px-3 pb-1 text-xs font-medium text-muted-foreground', hideCollapsed]"
        >
          {{ section.title }}
        </li>
        <li
          v-if="section.title && collapsed"
          class="mx-2 mb-1 hidden border-t md:block"
          aria-hidden="true"
        />
        <li v-for="item in section.items" :key="item.name">
          <!-- По имени; ключ магазина — явно, вне магазина его нет в адресе. -->
          <RouterLink
            v-slot="{ href, navigate, isActive, isExactActive }"
            :to="{ name: item.name, params: section.params }"
            custom
          >
            <Tooltip :text="item.label" side="right" :disabled="!collapsed">
              <a
                :href="href"
                :class="linkClass(isCurrent(item.path, isActive, isExactActive))"
                :aria-current="isCurrent(item.path, isActive, isExactActive) ? 'page' : undefined"
                :aria-label="collapsed ? item.label : undefined"
                @click="navigate"
              >
                <component :is="item.icon" aria-hidden="true" />
                <span :class="['truncate', hideCollapsed]">{{ item.label }}</span>
              </a>
            </Tooltip>
          </RouterLink>
        </li>
      </ul>
    </nav>

    <div class="flex flex-col gap-2 border-t pt-3">
      <div
        :class="[
          'flex items-center justify-between gap-2 px-3',
          collapsed && 'md:justify-center md:px-0',
        ]"
      >
        <span :class="['text-xs text-muted-foreground', hideCollapsed]">Тема</span>
        <ThemeToggle :class="hideCollapsed" />
        <ThemeToggle v-if="collapsed" vertical class="hidden md:inline-flex" />
      </div>
      <div
        :class="['flex items-center justify-between gap-2', collapsed && 'md:flex-col md:gap-1']"
      >
        <span :class="['min-w-0 truncate px-3 text-sm text-muted-foreground', hideCollapsed]">
          {{ who }}
        </span>
        <Tooltip text="Выйти" side="right" :disabled="!collapsed">
          <Button
            variant="ghost"
            size="sm"
            :aria-label="collapsed ? 'Выйти' : undefined"
            @click="logout"
          >
            <LogOut aria-hidden="true" />
            <span :class="hideCollapsed">Выйти</span>
          </Button>
        </Tooltip>
        <Tooltip :text="collapsed ? 'Развернуть меню' : 'Свернуть меню'" side="right">
          <Button
            variant="ghost"
            size="icon"
            class="hidden md:inline-flex"
            :aria-label="collapsed ? 'Развернуть меню' : 'Свернуть меню'"
            :aria-expanded="!collapsed"
            @click="emit('toggle')"
          >
            <PanelLeftOpen v-if="collapsed" />
            <PanelLeftClose v-else />
          </Button>
        </Tooltip>
      </div>
    </div>
  </aside>
</template>
