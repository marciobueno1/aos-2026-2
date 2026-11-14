import models, { sequelize } from "../models/index.js";
import {
  INITIAL_USERS,
  up,
  down,
} from "./20261114000001-initial-users-with-messages.js";

/**
 * Popula atomicamente os usuários iniciais (`rwieruch` ADMIN e `ddavids` USER)
 * com suas respectivas mensagens usando os modelos Sequelize dentro de uma transação.
 */
export const createUsersWithMessages = async () => {
  return await sequelize.transaction(async (t) => {
    const createdUsers = [];
    for (const userSeed of INITIAL_USERS) {
      const user = await models.User.create(
        {
          username: userSeed.username,
          email: userSeed.email,
          password: userSeed.password,
          role: userSeed.role,
          messages: userSeed.messages.map((m) => ({ ...m })),
        },
        {
          include: [models.Message],
          transaction: t,
        }
      );
      createdUsers.push(user);
    }
    return createdUsers;
  });
};

export { up, down };

export default {
  createUsersWithMessages,
  up,
  down,
};
