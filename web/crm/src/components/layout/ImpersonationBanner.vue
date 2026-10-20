<script setup lang="ts">
import { computed } from 'vue';

import { Button } from '@/components/ui/button';
import { useLogout } from '@/modules/auth/composables/useLogout.auth';
import { displayNameOf } from '@/modules/auth/mappers/mapMe.auth';
import { useAuthStore } from '@/modules/auth/store/store.auth';

/*
 * Плашка режима «за продавца». Видна на каждом экране шелла, чтобы админ не
 * забыл, чьими руками нажимает: права полные, запись остатков и ответы на
 * отзывы уходят от имени продавца.
 */
const auth = useAuthStore();
const { logout } = useLogout();

const who = computed(() => {
  const me = auth.me;
  if (me === null) return '';
  const nick = me.username !== null && me.name !== null ? ` (@${me.username})` : '';
  return `${displayNameOf(me)}${nick} · id ${me.telegramUserId}`;
});
</script>

<template>
  <div
    role="status"
    class="sticky top-0 z-[60] flex h-10 items-center gap-3 bg-warn px-4 text-sm font-medium text-black"
  >
    <span class="min-w-0 flex-1 truncate">
      Режим «за продавца»: {{ who }} — действия выполняются от его имени
    </span>
    <Button
      size="sm"
      variant="ghost"
      class="h-7 shrink-0 border border-black/30 text-black hover:bg-black/10 hover:text-black"
      @click="logout"
    >
      Выйти из режима
    </Button>
  </div>
</template>
