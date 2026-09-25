import type { Help, HelpResponse } from '../help.domain';

import { mapHelp } from '../mappers/mapHelp.help';

import { http } from '@/shared/http';

export const helpApi = {
  get: async (): Promise<Help> => mapHelp(await http.get<HelpResponse>('/help')),
};
