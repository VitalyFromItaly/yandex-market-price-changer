import { Request, Response, NextFunction } from 'express';
import getRawBody from 'raw-body';

export function telegramWebhookMiddleware(req: Request, res: Response, next: NextFunction) {
  // Применяем этот middleware только для telegram webhook'ов
  if (!req.path.includes('/telegram/webhooks/')) {
    return next();
  }

  // Если body уже был обработан другим middleware, пропускаем
  if (req.body && Object.keys(req.body).length > 0) {
    return next();
  }

  // Читаем raw body
  getRawBody(req, {
    length: req.headers['content-length'],
    limit: '1mb',
    encoding: 'utf8'
  })
    .then((rawBody: string) => {
      console.log('Telegram webhook raw body:', JSON.stringify(rawBody));
      
      try {
        // Сначала пытаемся парсить как есть
        req.body = JSON.parse(rawBody);
        next();
      } catch (parseError) {
        console.error('Telegram webhook parse error (attempt 1):', parseError);
        
        try {
          // Способ 2: убираем только переносы строк между JSON полями
          const cleanBody = rawBody
            .replace(/,\s*[\r\n]+\s*/g, ',') // запятая + перенос строки -> запятая
            .replace(/{\s*[\r\n]+\s*/g, '{') // { + перенос строки -> {
            .replace(/\[\s*[\r\n]+\s*/g, '[') // [ + перенос строки -> [
            .replace(/:\s*[\r\n]+\s*/g, ':') // : + перенос строки -> :
            .replace(/\s*[\r\n]+\s*}/g, '}') // перенос строки + } -> }
            .replace(/\s*[\r\n]+\s*]/g, ']'); // перенос строки + ] -> ]
          
          req.body = JSON.parse(cleanBody);
          next();
        } catch (secondParseError) {
          console.error('Telegram webhook parse error (attempt 2):', secondParseError);
          
          try {
            // Способ 3: агрессивная очистка - убираем все переносы строк
            const aggressiveCleanBody = rawBody
              .replace(/\r\n/g, '')
              .replace(/\r/g, '')
              .replace(/\n/g, '')
              .replace(/\s+/g, ' ')
              .trim();
            
            req.body = JSON.parse(aggressiveCleanBody);
            next();
          } catch (thirdParseError) {
            console.error('Failed to parse telegram webhook after all attempts:', thirdParseError);
            console.error('Raw body length:', rawBody.length);
            console.error('Raw body (first 500 chars):', rawBody.substring(0, 500));
            console.error('Raw body (last 500 chars):', rawBody.substring(Math.max(0, rawBody.length - 500)));
            
            // Telegram требует 200 OK, даже если обработка не удалась
            res.status(200).json({ ok: true });
          }
        }
      }
    })
    .catch((err) => {
      console.error('Error reading telegram webhook body:', err);
      res.status(400).json({ error: 'Failed to read request body' });
    });
} 