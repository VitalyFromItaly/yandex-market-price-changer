import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { Types } from 'mongoose';
import { UserModel } from '../database/mongo/models/user.model.mongo';

export class UserService {
  /**
   * Создание нового пользователя
   * @param username Имя пользователя
   * @param email Email
   * @param password Пароль
   * @returns Созданный пользователь
   */
  async createUser(username: string, email: string, password: string) {
    // Хэширование пароля
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Создание пользователя
    const user = new UserModel({
      username,
      email,
      password: hashedPassword
    });

    await user.save();
    return user;
  }

  /**
   * Поиск пользователя по ID
   * @param userId ID пользователя
   * @returns Пользователь или null
   */
  async getUserById(userId: string) {
    if (!Types.ObjectId.isValid(userId)) {
      return null;
    }
    return UserModel.findById(userId);
  }

  /**
   * Поиск пользователя по API токену
   * @param token API токен
   * @returns Пользователь или null
   */
  async getUserByToken(token: string) {
    if (!token) return null;
    return UserModel.findOne({ apiToken: token });
  }

  /**
   * Валидация учетных данных пользователя
   * @param email Email
   * @param password Пароль
   * @returns Пользователь или null
   */
  async validateCredentials(email: string, password: string) {
    const user = await UserModel.findOne({ email });
    if (!user) return null;

    //@ts-ignore
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) return null;

    return user;
  }

  /**
   * Поиск пользователя по имени или email
   * @param username Имя пользователя
   * @param email Email
   * @returns Пользователь или null
   */
  async findByUsernameOrEmail(username: string, email: string) {
    return UserModel.findOne({ $or: [{ username }, { email }] });
  }

  /**
   * Генерация нового API токена
   * @param userId ID пользователя
   * @returns Новый API токен
   */
  async generateToken(userId: string) {
    if (!Types.ObjectId.isValid(userId)) {
      throw new Error('Invalid user ID');
    }

    const token = crypto.randomBytes(32).toString('hex');
    await UserModel.findByIdAndUpdate(userId, { apiToken: token });
    return token;
  }

  /**
   * Получение всех пользователей (для админа)
   * @returns Массив пользователей без паролей
   */
  async getAllUsers() {
    return UserModel.find({}, { password: 0 });
  }

  /**
   * Проверка существования пользователя
   * @param userId ID пользователя
   * @returns true, если пользователь существует
   */
  async userExists(userId: string) {
    if (!Types.ObjectId.isValid(userId)) {
      return false;
    }
    const count = await UserModel.countDocuments({ _id: userId });
    return count > 0;
  }
}
