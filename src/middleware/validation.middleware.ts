// import { Request, Response, NextFunction } from 'express';
// import Joi from 'joi';
//
// export class ValidationMiddleware {
//   static validateConfig(req: Request, res: Response, next: NextFunction) {
//     // Схема валидации конфигурации
//     const schema = Joi.object({
//       name: Joi.string().required(),
//       // остальная схема валидации...
//     });
//
//     const validation = schema.validate(req.body);
//     if (validation.error) {
//       return res.status(400).json({
//         message: 'Validation Error',
//         details: validation.error.details
//       });
//     }
//
//     next();
//   }
//
//   // Другие методы валидации...
// }
