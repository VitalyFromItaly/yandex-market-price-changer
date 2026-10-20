import type {
  NotificationSettings,
  NotificationSettingsResponse,
  NotificationsFeed,
  NotificationsResponse,
  SettingsBody,
} from '../notifications.domain';

import { mapFeed, mapSettings } from '../mappers/mapNotifications.notifications';

import { http } from '@/shared/http';

const BASE = '/ym/notifications';

export const notificationsApi = {
  feed: async (unreadOnly: boolean): Promise<NotificationsFeed> =>
    mapFeed(await http.get<NotificationsResponse>(unreadOnly ? `${BASE}?unread=1` : BASE)),

  markRead: (ids: string[] | 'all'): Promise<{ updated: number }> =>
    http.post<{ updated: number }>(`${BASE}/read`, ids === 'all' ? { all: true } : { ids }),

  checkNow: (): Promise<{ queued: true }> => http.post<{ queued: true }>(`${BASE}/check`, {}),

  settings: async (): Promise<NotificationSettings> =>
    mapSettings(await http.get<NotificationSettingsResponse>(`${BASE}/settings`)),

  saveSettings: async (body: SettingsBody): Promise<NotificationSettings> =>
    mapSettings(await http.put<NotificationSettingsResponse>(`${BASE}/settings`, body)),
};
