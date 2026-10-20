import { UPLOAD_LIMITS } from '../../yandex/stocks/stock-upload-policy';
import { uploadFileErrorText } from '../../yandex/stocks/stock-upload.texts';
import { createUploadInterceptor } from '../crm-upload.interceptor';

/**
 * Multipart с прайсом: лимит — тот же `UPLOAD_LIMITS.maxBytes`, что у бота, и
 * 413 тем же текстом, что бот отвечает на слишком большой файл.
 */
export const PriceListUploadInterceptor = createUploadInterceptor({
  maxBytes: UPLOAD_LIMITS.maxBytes,
  tooLargeMessage: uploadFileErrorText('size', ''),
});
