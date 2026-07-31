<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount } from 'vue';

import type { IActionLogRow } from '../api';

// Разбор разметки берётся из общего модуля бэкенда, а не переписывается здесь:
// две копии такого расходятся молча, и панель начала бы показывать не то, что
// записано. Модуль чистый — ни Nest, ни Node в нём нет.
import { toSafeHtml } from '../../../src/shared/telegram-html';

const props = defineProps<{ row: IActionLogRow }>();
const emit = defineEmits<{ close: [] }>();

const formatter = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const when = computed(() => formatter.format(new Date(props.row.createdAt)));
const outgoing = computed(() => props.row.direction === 'out');

/** Сообщение в том виде, в каком его увидел пользователь в Telegram. */
const rendered = computed(() => toSafeHtml(props.row.action));

const who = computed(() => {
  const parts = [props.row.username ? `@${props.row.username}` : null, props.row.name].filter(
    Boolean,
  );
  return parts.length ? `${parts.join(' · ')} (${props.row.telegramUserId})` : props.row.telegramUserId;
});

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close');
}

// Escape закрывает окно: без этого единственный способ выйти — попасть по
// крестику, что на телефоне неудобно.
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <!-- Клик по подложке закрывает, клик внутри карточки — нет (@click.stop). -->
  <div class="backdrop" @click="emit('close')">
    <div class="card" @click.stop>
      <header>
        <span class="badge" :class="{ out: outgoing }">
          {{ outgoing ? 'бот → пользователю' : 'пользователь → боту' }}
        </span>
        <button type="button" class="close" aria-label="Закрыть" @click="emit('close')">✕</button>
      </header>

      <dl class="meta">
        <div><dt>Когда</dt><dd>{{ when }} МСК</dd></div>
        <div><dt>Кто</dt><dd>{{ who }}</dd></div>
        <div><dt>Тип</dt><dd>{{ row.kind }}</dd></div>
        <div v-if="row.durationMs !== undefined"><dt>Длительность</dt><dd>{{ row.durationMs }} мс</dd></div>
        <div v-if="row.chatId"><dt>Чат</dt><dd>{{ row.chatId }}</dd></div>
        <div v-if="row.source"><dt>Источник</dt><dd>{{ row.source }}</dd></div>
        <div v-if="row.errorType"><dt>Класс</dt><dd>{{ row.errorType }}</dd></div>
        <div v-if="row.httpStatus"><dt>Код</dt><dd>{{ row.httpStatus }}</dd></div>
        <div v-if="row.requestUrl"><dt>Запрос</dt><dd>{{ row.requestUrl }}</dd></div>
      </dl>

      <!-- Пузырь повторяет вид сообщения в телеграме: слева — то, что написал
           пользователь, справа — ответ бота. -->
      <div class="bubble" :class="{ out: outgoing }">
        <!-- eslint-disable-next-line vue/no-v-html -- разметка пропущена через
             белый список тегов в toSafeHtml; данные пользователя экранируются
             ещё при сборке сообщения. -->
        <div class="text" v-html="rendered"></div>
      </div>

      <p v-if="row.error" class="error">{{ row.error }}</p>

      <!-- Стек прячем под disclosure: он занимает экран целиком, а нужен
           только когда сообщения и места оказалось мало. -->
      <details v-if="row.stack">
        <summary>Стек вызовов</summary>
        <pre>{{ row.stack }}</pre>
      </details>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  z-index: 10;
}

.card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 14px;
  width: min(640px, 100%);
  max-height: 85vh;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.badge {
  font-size: 13px;
  color: var(--muted);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 3px 10px;
}

.badge.out {
  color: var(--accent);
  border-color: var(--accent);
}

.close {
  padding: 4px 10px;
}

.meta {
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px 16px;
  font-size: 13px;
}

.meta div {
  display: flex;
  gap: 6px;
}

.meta dt {
  color: var(--muted);
}

.meta dd {
  margin: 0;
}

.bubble {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px 14px;
  max-width: 92%;
}

.bubble.out {
  align-self: flex-end;
  border-color: var(--accent);
}

/* pre-wrap — сообщения многострочные, а отчёт это таблица из строк. */
.text {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 14px;
}

.text :deep(a) {
  color: var(--accent);
}

details summary {
  cursor: pointer;
  font-size: 13px;
  color: var(--muted);
}

details pre {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px;
  margin: 8px 0 0;
  max-height: 40vh;
  overflow: auto;
}

.text :deep(code),
.text :deep(pre) {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
}
</style>
