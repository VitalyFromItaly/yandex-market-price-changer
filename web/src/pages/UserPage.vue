<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import type { IFeature, IUserRow } from '../api';

import { deleteUser, fetchFeatures, fetchUser, setUserApproved, setUserFeature } from '../api';
import { describeError, token } from '../auth';
import ConfirmModal from '../components/ConfirmModal.vue';
import ToggleSwitch from '../components/ToggleSwitch.vue';
import { STATUS_LABEL, displayName, isApproved } from '../users.domain';

const props = defineProps<{ botId: string; telegramUserId: string }>();
const router = useRouter();

const user = ref<IUserRow | null>(null);
const features = ref<IFeature[]>([]);
const loading = ref(false);
/** Ключ фичи, которая прямо сейчас сохраняется; 'status' — тумблер доступа. */
const saving = ref('');
const loadError = ref('');
/** Открыта ли модалка подтверждения удаления и идёт ли само удаление. */
const showConfirm = ref(false);
const deleting = ref(false);

const approved = computed(() => !!user.value && isApproved(user.value));

onMounted(load);

async function load(): Promise<void> {
  if (!token.value) return;

  loading.value = true;
  loadError.value = '';

  try {
    const [row, registry] = await Promise.all([
      fetchUser(token.value, props.botId, props.telegramUserId),
      fetchFeatures(token.value),
    ]);
    user.value = row;
    features.value = registry;
  } catch (error) {
    loadError.value = describeError(error);
  } finally {
    loading.value = false;
  }
}

/**
 * Обе правки идут одним путём: отправить, дождаться, ЗАМЕНИТЬ строку ответом.
 *
 * Тумблер не хранит своё состояние, поэтому при ошибке он вернётся к тому, что
 * лежит в `user` — то есть к настоящему состоянию сервера. Иначе экран уверенно
 * показывал бы «доступ закрыт» у человека, у которого он открыт.
 */
async function save(key: string, run: (row: IUserRow) => Promise<IUserRow>): Promise<void> {
  if (!token.value || !user.value) return;

  saving.value = key;
  loadError.value = '';

  try {
    user.value = await run(user.value);
  } catch (error) {
    loadError.value = describeError(error);
  } finally {
    saving.value = '';
  }
}

function toggleAccess(value: boolean): void {
  void save('status', (row) => setUserApproved(token.value!, row, value));
}

function toggleFeature(key: string, value: boolean): void {
  void save(key, (row) => setUserFeature(token.value!, row, key, value));
}

/**
 * Удалить продавца. На успехе уходим к списку — карточки больше нет. При ошибке
 * остаёмся, показываем её и закрываем модалку (состояние сервера не изменилось).
 */
async function remove(): Promise<void> {
  if (!token.value || !user.value) return;

  deleting.value = true;
  loadError.value = '';

  try {
    await deleteUser(token.value, user.value);
    await router.push({ name: 'users' });
  } catch (error) {
    loadError.value = describeError(error);
    showConfirm.value = false;
  } finally {
    deleting.value = false;
  }
}
</script>

<template>
  <p><RouterLink to="/users">← К списку пользователей</RouterLink></p>

  <p v-if="loadError" class="error">{{ loadError }}</p>
  <p v-if="loading && !user" class="muted">Загрузка…</p>

  <template v-if="user">
    <header>
      <h1>{{ displayName(user) }}</h1>
      <p class="muted">
        <template v-if="user.username">@{{ user.username }} · </template>
        id {{ user.telegramUserId }} · {{ STATUS_LABEL[user.status] ?? user.status }}
      </p>
      <p class="muted">
        <template v-if="user.storeName">Магазин: {{ user.storeName }}</template>
        <template v-else>Магазин не подключён</template>
      </p>
    </header>

    <section>
      <h2>Доступ к боту</h2>
      <div class="item">
        <div class="text">
          <span class="label">Доступ открыт</span>
          <span class="muted">
            Выключите, чтобы закрыть доступ. Продавец получит сообщение об этом, а повторная
            регистрация станет доступна ему через сутки.
          </span>
        </div>
        <ToggleSwitch
          :model-value="approved"
          :disabled="!!saving"
          label="Доступ к боту"
          @change="toggleAccess"
        />
      </div>
    </section>

    <section>
      <h2>Возможности</h2>
      <!--
        Тумблеры остаются доступными и при закрытом доступе: набор возможностей
        готовят заранее, до одобрения заявки, — иначе пришлось бы сначала
        впустить продавца со всем сразу, а потом отбирать лишнее.
      -->
      <div v-for="feature in features" :key="feature.key" class="item">
        <div class="text">
          <span class="label">{{ feature.label }}</span>
          <span class="muted">{{ feature.description }}</span>
        </div>
        <ToggleSwitch
          :model-value="user.features[feature.key]"
          :disabled="!!saving"
          :label="feature.label"
          @change="(value) => toggleFeature(feature.key, value)"
        />
      </div>
    </section>

    <section>
      <h2>Удаление</h2>
      <div class="item">
        <div class="text">
          <span class="label">Удалить пользователя</span>
          <span class="muted">
            Сотрёт доступ, магазин с токеном, закупочные цены и расписания рассылки. Журнал действий
            останется. После удаления продавец сможет зарегистрироваться заново.
          </span>
        </div>
        <button
          type="button"
          class="danger"
          :disabled="!!saving || deleting"
          @click="showConfirm = true"
        >
          Удалить
        </button>
      </div>
    </section>

    <ConfirmModal
      v-if="showConfirm"
      title="Удалить пользователя?"
      :message="`${displayName(user)} будет удалён вместе с магазином, закупочными ценами и расписаниями. Действие необратимо, но продавец сможет зарегистрироваться заново.`"
      :busy="deleting"
      @confirm="remove"
      @cancel="showConfirm = false"
    />
  </template>
</template>

<style scoped>
header h1 {
  margin: 0 0 4px;
  font-size: 20px;
}

header p {
  margin: 0 0 2px;
}

h2 {
  margin: 0 0 8px;
  font-size: 15px;
}

section {
  margin-top: 20px;
}

.item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
}

.item + .item {
  margin-top: 8px;
}

.text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.label {
  font-size: 14px;
}

.muted {
  color: var(--muted);
  font-size: 13px;
}
</style>
