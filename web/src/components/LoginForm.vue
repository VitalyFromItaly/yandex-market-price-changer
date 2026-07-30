<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{ error?: string; busy?: boolean }>();
const emit = defineEmits<{ submit: [login: string, password: string] }>();

const login = ref('');
const password = ref('');

function submit(): void {
  if (!login.value.trim() || !password.value) return;
  emit('submit', login.value.trim(), password.value);
}
</script>

<template>
  <form class="login" @submit.prevent="submit">
    <h1>Журнал действий</h1>

    <label>
      Telegram id
      <!-- Не type="number": id это идентификатор, а не величина. Стрелки
           «увеличить на единицу» и экспоненциальная запись здесь бессмысленны. -->
      <input v-model="login" inputmode="numeric" autocomplete="username" placeholder="309809755" />
    </label>

    <label>
      Пароль
      <input v-model="password" type="password" autocomplete="current-password" />
    </label>

    <p v-if="props.error" class="error">{{ props.error }}</p>

    <button class="primary" type="submit" :disabled="props.busy">
      {{ props.busy ? 'Проверяем…' : 'Войти' }}
    </button>

    <p class="hint">
      Логин — ваш Telegram id из <code>TELEGRAM_ADMIN_IDS</code>. Пароль показан в логах приложения
      один раз, при первом запуске.
    </p>
  </form>
</template>

<style scoped>
.login {
  max-width: 360px;
  margin: 12vh auto 0;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
}

h1 {
  margin: 0;
  font-size: 20px;
}

.hint {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
}

code {
  font-size: 12px;
}
</style>
