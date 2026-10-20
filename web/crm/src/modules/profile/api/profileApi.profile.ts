import type { Profile, ProfileResponse } from '../profile.domain';

import { mapProfile } from '../mappers/mapProfile.profile';

import { http } from '@/shared/http';

export const profileApi = {
  get: async (): Promise<Profile> => mapProfile(await http.get<ProfileResponse>('/profile')),
};
