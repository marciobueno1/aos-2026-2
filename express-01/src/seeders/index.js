import "dotenv/config";
import models, { sequelize } from "../models/index.js";
import {
  buildInitialUsers,
  up,
  down,
} from "./20261114000001-initial-users-with-messages.js";

/**
 * Popula atomicamente os usuários iniciais (`rwieruch` ADMIN e `ddavids` USER)
 * com suas respectivas mensagens usando os modelos Sequelize dentro de uma transação.
 *
 * @param {object} [options]
 * @param {Record<string, string | undefined>} [options.env=process.env]
 * @param {{ warn?: Function }} [options.logger=console]
 */
export const createUsersWithMessages = async ({
  env = process.env,
  logger = console,
} = {}) => {
  const usersToSeed = buildInitialUsers({ env, logger });

  return await sequelize.transaction(async (t) => {
    const createdUsers = [];
    for (const userSeed of usersToSeed) {
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

/**
 * Executa o seeder inicial via CLI com logging e fechamento seguro da conexão.
 *
 * @param {object} [options]
 * @param {boolean} [options.closeConnection=true]
 * @param {{ log: Function, error: Function }} [options.logger=console]
 * @returns {Promise<Array | undefined>}
 */
export const runSeeders = async ({
  closeConnection = true,
  logger = console,
} = {}) => {
  try {
    const users = await createUsersWithMessages();
    logger.log(
      `[seeders] ${users.length} usuário(s) inicial(is) populado(s) com sucesso.`
    );
    return users;
  } catch (error) {
    process.exitCode = 1;
    logger.error("[seeders] Falha ao popular banco de dados:", error);
    return undefined;
  } finally {
    if (closeConnection) {
      await sequelize.close();
    }
  }
};

export { up, down };

export default {
  createUsersWithMessages,
  runSeeders,
  up,
  down,
};
