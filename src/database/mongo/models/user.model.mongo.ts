import mongoose from 'mongoose';
import crypto from 'crypto';

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  apiToken: { type: String, unique: true },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Метод для генерации API токена
UserSchema.methods.generateToken = function() {
  this.apiToken = crypto.randomBytes(32).toString('hex');
  return this.apiToken;
};

// Метод для валидации токена
UserSchema.statics.findByToken = async function(token) {
  if (!token) {
    return null;
  }
  return this.findOne({ apiToken: token });
};

export const UserModel = mongoose.model('User', UserSchema);
