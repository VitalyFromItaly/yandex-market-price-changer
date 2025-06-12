import { Types } from 'mongoose';
import { UserContext } from '../../services/UserService';

declare global {
  namespace Express {
    interface Request {
      userId: string;
      userContext?: UserContext;
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
