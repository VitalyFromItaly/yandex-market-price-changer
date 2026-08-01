<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import type { IUserRow } from '../api';

import { fetchLogs, fetchUsers } from '../api';
import { describeError, token } from '../auth';
import { displayName } from '../users.domain';

/** Окно, за которое считаются ошибки. Сутки — ровно «со вчера». */
const ERROR_WINDOW_HOURS = 24;

const users = ref<IUserRow[]>([]);
const errors = ref(0);
const loading = ref(false);
const loadError = ref('');

/**
 * Заявки, ждущие решения, — единственное, что БЛОКИРУЕТ человека на той
 * стороне: он прислал токен и сидит без ответа. Поэтому именно они наверху и
 * единственные окрашены.
 */
const pending = computed(() => users.value.filter((u) => u.status === 'pending'));
const approved = computed(() => users.value.filter((u) => u.status === 'approved').length);
const configured = computed(() => users.value.filter((u) => u.configured).length);
const quiet = computed(() => !loading.value && !pending.value.length && !errors.value);

onMounted(load);

async function load(): Promise<void> {
  if (!token.value) return;

  loading.value = true;
  loadError.value = '';

  try {
    const since = new Date(Date.now() - ERROR_WINDOW_HOURS * 3600_000).toISOString();
    // limit: 1 — нужна только цифра total, сами строки читают в журнале.
    const [items, log] = await Promise.all([
      fetchUsers(token.value),
      fetchLogs(token.value, { status: 'error', since, limit: 1 }),
    ]);
    users.value = items;
    errors.value = log.total;
  } catch (error) {
    loadError.value = describeError(error);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <header>
    <h1>Обзор</h1>
    <button type="button" :disabled="loading" @click="load">
      {{ loading ? 'Загрузка…' : 'Обновить' }}
    </button>
  </header>

  <p v-if="loadError" class="error">{{ loadError }}</p>

  <section class="attention">
    <h2>Требует внимания</h2>

    <!-- Первая загрузка отделена от пустоты: иначе экран на полсекунды
         утверждает «всё спокойно», ещё не спросив об этом сервер. -->
    <p v-if="loading && !users.length" class="calm">Загрузка…</p>

    <!-- Пустое состояние — это ХОРОШИЙ день, и выглядеть оно должно спокойно,
         а не как «нет данных». -->
    <p v-else-if="quiet" class="calm">Всё спокойно: заявок нет, ошибок за сутки тоже.</p>

    <ul v-else class="cards">
      <li v-if="pending.length" class="card warn">
        <span class="dot"></span>
        <div class="body">
          <span class="label">Заявки ждут решения</span>
          <span class="muted">Продавец прислал токен и ждёт ответа.</span>
          <ul class="people">
            <li v-for="user in pending" :key="`${user.botId}:${user.telegramUserId}`">
              <RouterLink :to="`/users/${user.botId}/${user.telegramUserId}`">
                {{ displayName(user) }}
              </RouterLink>
            </li>
          </ul>
        </div>
        <span class="count tnum">{{ pending.length }}</span>
      </li>

      <li v-if="errors" class="card danger">
        <span class="dot"></span>
        <div class="body">
          <span class="label">Ошибки за сутки</span>
          <span class="muted">
            <RouterLink to="/logs">Открыть журнал</RouterLink> и отфильтровать по статусу
            «ошибка».
          </span>
        </div>
        <span class="count tnum">{{ errors }}</span>
      </li>
    </ul>
  </section>

  <!-- Цифры без цвета и без рамок-карточек: это фон, а не повод к действию. -->
  <section class="totals">
    <div>
      <span class="n tnum">{{ users.length }}</span>
      <span class="muted">продавцов всего</span>
    </div>
    <div>
      <span class="n tnum">{{ approved }}</span>
      <span class="muted">с доступом</span>
    </div>
    <div>
      <span class="n tnum">{{ configured }}</span>
      <span class="muted">подключили магазин</span>
    </div>
  </section>

  <p class="muted hint">
    Возможности бота настраиваются в разделе
    <RouterLink to="/users">Пользователи</RouterLink> — на карточке продавца.
  </p>
</template>

<style scoped>
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

h1 {
  margin: 0;
  font-size: 22px;
  letter-spacing: -0.01em;
}

h2 {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 500;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.calm {
  margin: 0;
  color: var(--muted);
  font-size: 14px;
}

.cards,
.people {
  list-style: none;
  margin: 0;
  padding: 0;
}

.cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
}

/* Цветная точка вместо цветной рамки: сигнал читается, но блок не кричит. */
.dot {
  width: 8px;
  height: 8px;
  margin-top: 6px;
  border-radius: 50%;
  flex: none;
}

.warn .dot {
  background: var(--warn);
}

.danger .dot {
  background: var(--danger);
}

.body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.label {
  font-size: 14px;
  font-weight: 500;
}

.people {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  font-size: 13px;
}

.count {
  font-size: 22px;
  font-weight: 600;
  line-height: 1.1;
}

.warn .count {
  color: var(--warn);
}

.danger .count {
  color: var(--danger);
}

.totals {
  display: flex;
  flex-wrap: wrap;
  gap: 32px;
  padding-top: 4px;
}

.totals div {
  display: flex;
  flex-direction: column;
}

.n {
  font-size: 20px;
  font-weight: 600;
}

.muted {
  color: var(--muted);
  font-size: 13px;
}

.hint {
  margin: 0;
}
</style>
