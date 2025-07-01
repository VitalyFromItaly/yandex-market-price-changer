import { Types } from 'mongoose';

declare global {
  namespace Express {
    interface Request {
      userId: string;
      user?: {
        _id: Types.ObjectId | string;
        username: string;
        email: string;
        apiToken?: string;
        isAdmin?: boolean;
        [key: string]: any;
      };
    }
  }
}

export interface AuthenticatedRequest extends Request {
  userId: string;
  user?: any;
}

export type ControllerMethod = (req: AuthenticatedRequest, res: Response) => Promise<void>;
