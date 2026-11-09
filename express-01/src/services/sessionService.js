import crypto from "crypto";
import jwt from "jsonwebtoken";
import models from "../models/index.js";
import { env, AppError } from "../utils/index.js";

const hashRefreshToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const createAccessToken = (user) => {
  return jwt.sign(
    { id: user.id, username: user.username, email: user.email },
    env.JWT_SECRET,
    { expiresIn: "15m", algorithm: "HS256" }
  );
};

const createRefreshToken = async (userId, originalExpiresAt = null) => {
  const token = crypto.randomBytes(40).toString("hex");
  let expiresAt = originalExpiresAt;
  if (!expiresAt) {
    expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
  }

  await models.RefreshToken.create({
    token: hashRefreshToken(token),
    expiresAt,
    userId,
  });

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
  const dbToken = await models.RefreshToken.findOne({
    where: { token: hashRefreshToken(oldRefreshToken) },
    include: [models.User],
  });

  if (!dbToken || new Date(dbToken.expiresAt) < new Date()) {
    if (dbToken) {
      await dbToken.destroy();
    }
    throw new AppError("Refresh token inválido ou expirado.", 401);
  }

  const user = dbToken.user;
  if (!user) {
    await dbToken.destroy();
    throw new AppError("Refresh token inválido ou expirado.", 401);
  }

  const originalExpiresAt = dbToken.expiresAt;

  // Token Rotation: remove o token consumido de forma atômica para evitar reuso concorrente
  const deletedCount = await models.RefreshToken.destroy({
    where: { id: dbToken.id },
  });
  if (deletedCount === 0) {
    throw new AppError("Refresh token inválido ou expirado.", 401);
  }

  const accessToken = createAccessToken(user);
  const newRefreshToken = await createRefreshToken(user.id, originalExpiresAt);

  return {
    accessToken,
    refreshToken: newRefreshToken.token,
    user,
  };
};

const destroyRefreshToken = async (token) => {
  if (!token) return;
  await models.RefreshToken.destroy({
    where: { token: hashRefreshToken(token) },
  });
};

const destroyUserRefreshTokens = async (userId) => {
  if (!userId) return;
  await models.RefreshToken.destroy({
    where: { userId },
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
