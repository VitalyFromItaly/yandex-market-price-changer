import type { LoginForm, Me, MeResponse, SessionResponse } from '../auth.domain';

import { mapMe } from '../mappers/mapMe.auth';

import { http } from '@/shared/http';

export const authApi = {
  login: (form: LoginForm): Promise<SessionResponse> =>
    http.post<SessionResponse>('/auth/login', { login: form.login, password: form.password }),

  me: async (): Promise<Me> => mapMe(await http.get<MeResponse>('/auth/me')),

  changePassword: (current: string, next: string): Promise<SessionResponse> =>
    http.post<SessionResponse>('/auth/password', { current, next }),
};
