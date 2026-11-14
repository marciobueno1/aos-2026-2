import models from "../models/index.js";
import sessionService from "./sessionService.js";
import { AppError } from "../utils/index.js";

const getAllUsers = async () => {
  return await models.User.findAll();
};

const getUserById = async (id) => {
  return await models.User.findByPk(id);
};

const getUserByLogin = async (login) => {
  return await models.User.findByLogin(login);
};

const createUser = async ({ username, email, password }) => {
  return await models.User.create({
    username,
    email,
    password,
  });
};

const updateUser = async (
  id,
  { username, email, password, role },
  actor = null
) => {
  if (role !== undefined && actor?.role !== "ADMIN") {
    throw new AppError(
      "Apenas administradores podem alterar perfis de acesso.",
      403
    );
  }

  const user = await getUserById(id);
  if (!user) {
    return null;
  }

  const roleChanged = role !== undefined && user.role !== role;

  const updatedUser = await user.update({
    ...(username !== undefined && { username }),
    ...(email !== undefined && { email }),
    ...(password !== undefined && { password }),
    ...(role !== undefined && { role }),
  });

  if (password !== undefined || roleChanged) {
    await sessionService.destroyUserRefreshTokens(id);
  }

  return updatedUser;
};

const deleteUser = async (id) => {
  const count = await models.User.destroy({
    where: { id },
  });
  return count > 0;
};

export default {
  getAllUsers,
  getUserById,
  getUserByLogin,
  createUser,
  updateUser,
  deleteUser,
};
