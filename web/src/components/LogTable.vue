<script setup lang="ts">
import type { IActionLogRow } from '../api';

// Плоский текст для строки таблицы — из общего с бэкендом модуля.
import { toPlainText } from '../../../src/shared/telegram-html';

defineProps<{ rows: IActionLogRow[] }>();
const emit = defineEmits<{ select: [row: IActionLogRow] }>();

/**
 * Подписи методов Bot API — они приходят в том же поле kind у исходящих.
 * Показывать «answerCallbackQuery» администратору незачем.
 */
const KIND_LABELS: Record<string, string> = {
  sendMessage: 'сообщение',
  sendDocument: 'файл',
  sendPhoto: 'фото',
  editMessageText: 'правка сообщения',
  answerCallbackQuery: 'ответ на нажатие',
  error: 'ошибка',
  command: 'команда',
  menu: 'меню',
  callback: 'кнопка',
  document: 'файл',
  text: 'текст',
  other: 'прочее',
};

/**
 * Время по Москве.
 *
 * Панель открывают из разных часовых поясов, а расписания рассылок и все
 * разговоры про «во сколько это было» ведутся в московском времени — тем же,
 * в котором работает MOSCOW_TIME_ZONE на бэкенде.
 */
const formatter = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function formatTime(iso: string): string {
  return formatter.format(new Date(iso));
}

/** Кто: ник, если есть; иначе имя; иначе только id. */
function who(row: IActionLogRow): string {
  if (row.username) return `@${row.username}`;
  return row.name || `id ${row.telegramUserId}`;
}
</script>

<template>
  <div class="wrap">
    <table>
      <thead>
        <tr>
          <th>Время (МСК)</th>
          <th></th>
          <th>Кто</th>
          <th>Тип</th>
          <th>Действие</th>
          <th class="num">мс</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row._id"
          class="row"
          :class="{ failed: row.status === 'error' }"
          @click="emit('select', row)"
        >
          <td class="nowrap">{{ formatTime(row.createdAt) }}</td>
          <!-- Стрелка вместо слова: направление читается мгновенно и не
               занимает колонку шириной в «от пользователя». -->
          <td class="dir" :title="row.direction === 'out' ? 'бот → пользователю' : 'пользователь → боту'">
            {{ row.direction === 'out' ? '→' : '←' }}
          </td>
          <td>
            <div>{{ who(row) }}</div>
            <!-- id показывается всегда: ник меняется, id — нет, и именно он
                 нужен, чтобы отфильтровать историю конкретного продавца. -->
            <div class="muted">{{ row.telegramUserId }}</div>
          </td>
          <td class="nowrap">{{ KIND_LABELS[row.kind] ?? row.kind }}</td>
          <td>
            <!-- В таблице — одна строка без разметки: полный текст и
                 форматирование показывает модалка по клику. -->
            <span class="action">{{ toPlainText(row.action) }}</span>
            <div v-if="row.error" class="muted err">{{ row.error }}</div>
          </td>
          <td class="num">{{ row.durationMs ?? '—' }}</td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="6" class="empty">Записей нет</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
/* Таблица шире экрана телефона неизбежно — пусть прокручивается она, а не
   страница целиком. */
.wrap {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: 12px;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

th,
td {
  padding: 8px 12px;
  text-align: left;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}

th {
  background: var(--surface);
  font-size: 13px;
  color: var(--muted);
  position: sticky;
  top: 0;
}

tr:last-child td {
  border-bottom: none;
}

.failed {
  background: var(--danger-bg);
}

.dir {
  color: var(--muted);
  font-size: 16px;
  text-align: center;
}

/* В таблице сообщение сжато до одной строки: она нужна, чтобы найти нужную
   запись, а читают её в модалке. Многострочный отчёт растянул бы таблицу так,
   что на экран поместилось бы три записи. */
.action {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.row {
  cursor: pointer;
}

.row:hover {
  background: var(--surface);
}

.muted {
  color: var(--muted);
  font-size: 12px;
}

.err {
  color: var(--danger);
}

.nowrap {
  white-space: nowrap;
}

.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.empty {
  text-align: center;
  color: var(--muted);
  padding: 32px;
}
</style>
