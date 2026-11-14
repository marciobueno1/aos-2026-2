import crypto from "crypto";
import jwt from "jsonwebtoken";
import models, { sequelize } from "../models/index.js";
import { env, AppError } from "../utils/index.js";

const hashRefreshToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const createAccessToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
    },
    env.JWT_SECRET,
    { expiresIn: "15m", algorithm: "HS256" }
  );
};

/**
 * Gera e persiste um refresh token opaco associado ao usuário.
 * Aceita uma transação opcional para composição atômica em operações compostas.
 */
const createRefreshToken = async (
  userId,
  originalExpiresAt = null,
  options = {}
) => {
  const token = crypto.randomBytes(40).toString("hex");
  let expiresAt = originalExpiresAt;
  if (!expiresAt) {
    expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
  }

  await models.RefreshToken.create(
    {
      token: hashRefreshToken(token),
      expiresAt,
      userId,
    },
    {
      ...(options.transaction && { transaction: options.transaction }),
    }
  );

  return { token, expiresAt };
};

const authenticate = async (login, password) => {
  const user = await models.User.findByLogin(login);
  if (!user) {
    throw new AppError("Credenciais inválidas.", 401);
  }

  const isValid = await user.validatePassword(password);
  if (!isValid) {
    throw new AppError("Credenciais inválidas.", 401);
  }

  const accessToken = createAccessToken(user);
  const refreshTokenRecord = await createRefreshToken(user.id);

  return {
    accessToken,
    refreshToken: refreshTokenRecord.token,
    user,
  };
};

const rotateRefreshToken = async (oldRefreshToken) => {
  const result = await sequelize.transaction(async (t) => {
    const dbToken = await models.RefreshToken.findOne({
      where: { token: hashRefreshToken(oldRefreshToken) },
      include: [models.User],
      transaction: t,
      ...(t?.LOCK?.UPDATE && {
        lock: { level: t.LOCK.UPDATE, of: models.RefreshToken },
      }),
    });

    if (!dbToken || new Date(dbToken.expiresAt) < new Date() || !dbToken.user) {
      if (dbToken) {
        await dbToken.destroy({ transaction: t });
      }
      return { invalidOrExpired: true };
    }

    const originalExpiresAt = dbToken.expiresAt;
    const lockedUser =
      t?.LOCK?.UPDATE && dbToken.user?.id
        ? await models.User.findByPk(dbToken.user.id, {
            transaction: t,
            lock: t.LOCK.UPDATE,
          })
        : null;
    const user = lockedUser || dbToken.user;

    // Token Rotation atômica: garante que remoção do antigo e criação do novo ocorram na mesma transação
    const deletedCount = await models.RefreshToken.destroy({
      where: { id: dbToken.id },
      transaction: t,
    });
    if (deletedCount === 0) {
      throw new AppError("Refresh token inválido ou expirado.", 401);
    }

    const accessToken = createAccessToken(user);
    const newRefreshToken = await createRefreshToken(
      user.id,
      originalExpiresAt,
      { transaction: t }
    );

    return {
      accessToken,
      refreshToken: newRefreshToken.token,
      user,
    };
  });

  if (result?.invalidOrExpired) {
    throw new AppError("Refresh token inválido ou expirado.", 401);
  }

  return result;
};

const destroyRefreshToken = async (token) => {
  if (!token) return;
  await models.RefreshToken.destroy({
    where: { token: hashRefreshToken(token) },
  });
};

/**
 * Revoga todos os refresh tokens ativos de um usuário.
 * Aceita uma transação opcional para manter atomicidade com mutações no usuário.
 */
const destroyUserRefreshTokens = async (userId, options = {}) => {
  if (!userId) return;
  await models.RefreshToken.destroy({
    where: { userId },
    ...(options.transaction && { transaction: options.transaction }),
  });
};

export default {
  hashRefreshToken,
  createAccessToken,
  createRefreshToken,
  authenticate,
  rotateRefreshToken,
  destroyRefreshToken,
  destroyUserRefreshTokens,
};
