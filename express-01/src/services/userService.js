import models, { sequelize } from "../models/index.js";
import sessionService from "./sessionService.js";
import { AppError } from "../utils/index.js";

const getAllUsers = async () => {
  return await models.User.findAll();
};

const getUserById = async (id, options = {}) => {
  const queryOptions = {
    ...(options.transaction && { transaction: options.transaction }),
    ...(options.lock && { lock: options.lock }),
  };
  return Object.keys(queryOptions).length > 0
    ? await models.User.findByPk(id, queryOptions)
    : await models.User.findByPk(id);
};

const getUserByLogin = async (login) => {
  return await models.User.findByLogin(login);
};

/**
 * Cria um usuário e, opcionalmente, mensagens iniciais em uma transação atômica.
 * Reutiliza `options.transaction` caso já exista uma transação em andamento.
 */
const createUser = async (
  { username, email, password, messages },
  options = {}
) => {
  const executeCreate = async (t) => {
    const hasMessages = Array.isArray(messages) && messages.length > 0;
    return await models.User.create(
      {
        username,
        email,
        password,
        ...(hasMessages && { messages }),
      },
      {
        ...(hasMessages && { include: [models.Message] }),
        transaction: t,
      }
    );
  };

  if (options.transaction) {
    return await executeCreate(options.transaction);
  }

  return await sequelize.transaction(executeCreate);
};

/**
 * Atualiza os dados do usuário e revoga refresh tokens em caso de troca de senha
 * ou alteração efetiva de papel, garantindo rollback completo se a revogação falhar.
 */
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

  return await sequelize.transaction(async (t) => {
    const user = await getUserById(id, {
      transaction: t,
      ...(t?.LOCK?.UPDATE && { lock: t.LOCK.UPDATE }),
    });
    if (!user) {
      return null;
    }

    const roleChanged = role !== undefined && user.role !== role;

    const updatedUser = await user.update(
      {
        ...(username !== undefined && { username }),
        ...(email !== undefined && { email }),
        ...(password !== undefined && { password }),
        ...(role !== undefined && { role }),
      },
      { transaction: t }
    );

    if (password !== undefined || roleChanged) {
      await sessionService.destroyUserRefreshTokens(id, { transaction: t });
    }

    return updatedUser;
  });
};

/**
 * Exclui um usuário de forma atômica dentro de uma transação gerenciada.
 */
const deleteUser = async (id) => {
  return await sequelize.transaction(async (t) => {
    const count = await models.User.destroy({
      where: { id },
      transaction: t,
    });
    return count > 0;
  });
};

export default {
  getAllUsers,
  getUserById,
  getUserByLogin,
  createUser,
  updateUser,
  deleteUser,
};
