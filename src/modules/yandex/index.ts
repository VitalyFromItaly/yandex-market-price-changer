import { PriceChanger } from './handlers/price.changer.handler';
import { TUpdateOffer } from './yandex.domain';

const YANDEX_MARKET_TOKEN =
  process.env.ARTEM_YANDEX_MARKET_TOKEN || '';
const YANDEX_MARKET_CAMPAIGN_ID =  +process.env.ARTEM_YANDEX_MARKET_CAMPAIGN_ID;
const YANDEX_MARKET_BUSINESS_ID =  +process.env.ARTEM_YANDEX_MARKET_BUSINESS_ID;

export async function testYanndexMarket() {
  console.log('Yandex Market test function called');
  // Здесь можно добавить логику для тестирования Yandex Market

  const priceChanger = new PriceChanger(
    YANDEX_MARKET_TOKEN,
    YANDEX_MARKET_CAMPAIGN_ID,
    YANDEX_MARKET_BUSINESS_ID,
  );

  await priceChanger.productsService.loadAllOffers();
  // 24850
  const offerToUpdate: TUpdateOffer = {
    offerId: 'GA-B2100CD-1A4',
    price: {
      value: 24850,
      currencyId: 'RUR'
    }
  };
  // await priceChanger.productsService.updateOfferPrice({ offers: [offerToUpdate] });
}
