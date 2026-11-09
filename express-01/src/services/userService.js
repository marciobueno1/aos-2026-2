import models from "../models/index.js";
import sessionService from "./sessionService.js";

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

const updateUser = async (id, { username, email, password }) => {
  const user = await getUserById(id);
  if (!user) {
    return null;
  }
  const updatedUser = await user.update({
    ...(username !== undefined && { username }),
    ...(email !== undefined && { email }),
    ...(password !== undefined && { password }),
  });

  if (password !== undefined) {
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
