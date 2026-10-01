import { userService } from "../services/index.js";
import { AppError } from "../utils/index.js";

const getUsers = async (req, res) => {
  const users = await userService.getAllUsers();
  return res.status(200).send(users);
};

const getUser = async (req, res) => {
  const user = await userService.getUserById(req.params.userId);
  if (!user) {
    throw new AppError("Usuário não encontrado.", 404);
  }
  return res.status(200).send(user);
};

const createUser = async (req, res) => {
  const { username, email } = req.body || {};
  const user = await userService.createUser({
    username,
    email,
  });
  return res.status(201).send(user);
};

const updateUser = async (req, res) => {
  const { username, email } = req.body || {};
  const user = await userService.updateUser(req.params.userId, {
    username,
    email,
  });
  if (!user) {
    throw new AppError("Usuário não encontrado.", 404);
  }
  return res.status(200).send(user);
};

const deleteUser = async (req, res) => {
  const isDeleted = await userService.deleteUser(req.params.userId);
  if (!isDeleted) {
    throw new AppError("Usuário não encontrado.", 404);
  }
  return res.status(204).send();
};

export default {
  getUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
};
