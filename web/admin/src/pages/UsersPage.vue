<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import type { IFeature, IUserRow } from '../api';

import { fetchFeatures, fetchUsers } from '../api';
import { describeError, token } from '../auth';
import UsersTable from '../components/UsersTable.vue';

const router = useRouter();

const users = ref<IUserRow[]>([]);
const features = ref<IFeature[]>([]);
const loading = ref(false);
const loadError = ref('');

onMounted(load);

async function load(): Promise<void> {
  if (!token.value) return;

  loading.value = true;
  loadError.value = '';

  try {
    // Реестр возможностей нужен списку ради знаменателя «N из M» и
    // запрашивается вместе с людьми: порознь колонка успевала мигнуть пустой.
    const [items, registry] = await Promise.all([
      fetchUsers(token.value),
      fetchFeatures(token.value),
    ]);
    users.value = items;
    features.value = registry;
  } catch (error) {
    loadError.value = describeError(error);
  } finally {
    loading.value = false;
  }
}

function open(user: IUserRow): void {
  void router.push({
    name: 'user',
    params: { botId: user.botId, telegramUserId: user.telegramUserId },
  });
}
</script>

<template>
  <header>
    <h1>Пользователи</h1>
    <button type="button" :disabled="loading" @click="load">
      {{ loading ? 'Загрузка…' : 'Обновить' }}
    </button>
  </header>

  <p v-if="loadError" class="error">{{ loadError }}</p>

  <p class="muted">Нажмите на строку, чтобы открыть карточку продавца.</p>

  <UsersTable :users="users" :features="features" @open="open" />

  <footer>
    <span class="muted">{{ users.length ? `Всего: ${users.length}` : 'Пользователей нет' }}</span>
  </footer>
</template>

<style scoped>
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

h1 {
  margin: 0;
  font-size: 22px;
  letter-spacing: -0.01em;
}

footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.muted {
  color: var(--muted);
  font-size: 13px;
}
</style>
