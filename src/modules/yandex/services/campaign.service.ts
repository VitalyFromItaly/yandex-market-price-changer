import { HttpClient } from '../../../transport/http';
import { TCampaign } from '../yandex.domain';

/**
 * Сервис для работы с кампаниями в Яндекс Маркете
 * позволяет получать информацию о своих кампаниях/магазинах
 */
export class CampaignService {
  constructor(private readonly httpClient: HttpClient) {}

  public async getCampaigns(): Promise<TCampaign[]> {
    try {
      const response = await this.httpClient.get('/campaigns');
      return response.data.campaigns || [];
    } catch (error) {
      console.error('Error fetching campaigns:', error);
      throw error;
    }
  }
}
