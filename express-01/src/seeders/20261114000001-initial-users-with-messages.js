import crypto from "crypto";
import argon2 from "argon2";
import { Op } from "sequelize";
import models, { sequelize } from "../models/index.js";

export const INITIAL_USERS = [
  {
    username: "rwieruch",
    email: "rwieruch@email.com",
    passwordEnv: "ADMIN_PASSWORD",
    role: "ADMIN",
    messages: [
      {
        text: "Published the Road to learn React",
      },
    ],
  },
  {
    username: "ddavids",
    email: "ddavids@email.com",
    passwordEnv: "USER_PASSWORD",
    role: "USER",
    messages: [
      {
        text: "Happy to release ...",
      },
      {
        text: "Published a complete ...",
      },
    ],
  },
];

/**
 * Resolve a senha de seed a partir do ambiente ou gera um segredo criptográfico
 * aleatório de 32 caracteres Base64 via CSPRNG (equivalente a `openssl rand -base64 24`).
 *
 * Somente com NODE_ENV=development exibe a senha gerada no console para uso local.
 * Em produção, CI (NODE_ENV ausente) ou outros ambientes, omite o segredo do log (CWE-532).
 *
 * @param {object} params
 * @param {string} params.envVarName
 * @param {string} params.username
 * @param {Record<string, string | undefined>} [params.env=process.env]
 * @param {{ warn?: Function }} [params.logger=console]
 * @returns {string}
 */
export const resolveSeedPassword = ({
  envVarName,
  username,
  env = process.env,
  logger = console,
}) => {
  const configuredPassword = env?.[envVarName];
  if (typeof configuredPassword === "string" && configuredPassword.length > 0) {
    return configuredPassword;
  }

  const generatedPassword = crypto.randomBytes(24).toString("base64");
  const warn =
    typeof logger?.warn === "function"
      ? logger.warn.bind(logger)
      : console.warn;

  if (env?.NODE_ENV === "development") {
    warn(
      `[seeders] ${envVarName} não definida. Senha gerada para '${username}': ${generatedPassword} (anote esta senha ou configure ${envVarName} no .env)`
    );
  } else if (env?.NODE_ENV !== "test") {
    // production, NODE_ENV ausente (ex.: CI) ou qualquer outro valor: nunca exibe o segredo (CWE-532)
    warn(
      `[seeders] ${envVarName} não definida. Uma senha aleatória foi atribuída a '${username}'. Configure ${envVarName} nas variáveis de ambiente.`
    );
  }

  return generatedPassword;
};

/**
 * Constrói os registros iniciais de usuários com senhas resolvidas por variável de ambiente
 * ou geradas aleatoriamente via CSPRNG.
 *
 * @param {object} [options]
 * @param {Record<string, string | undefined>} [options.env=process.env]
 * @param {{ warn?: Function }} [options.logger=console]
 * @returns {Array<{ username: string, email: string, password: string, role: string, messages: Array<{ text: string }> }>}
 */
export const buildInitialUsers = ({
  env = process.env,
  logger = console,
} = {}) =>
  INITIAL_USERS.map((userSeed) => ({
    username: userSeed.username,
    email: userSeed.email,
    password: resolveSeedPassword({
      envVarName: userSeed.passwordEnv,
      username: userSeed.username,
      env,
      logger,
    }),
    role: userSeed.role,
    messages: userSeed.messages.map((m) => ({ ...m })),
  }));

const runInTransaction = async (queryInterface, callback) => {
  if (queryInterface?.sequelize?.transaction) {
    return await queryInterface.sequelize.transaction(callback);
  }
  return await sequelize.transaction(callback);
};

/**
 * Seeder oficial (Sequelize CLI) que insere atomicamente os usuários iniciais
 * (`rwieruch` ADMIN e `ddavids` USER) com senhas Argon2 e mensagens associadas.
 */
export const up = async (queryInterface, _Sequelize) => {
  const now = new Date();
  const usersRows = [];
  const messagesRows = [];
  const usersToSeed = buildInitialUsers();

  for (const userSeed of usersToSeed) {
    const userId = crypto.randomUUID();
    const passwordHash = await argon2.hash(userSeed.password);

    usersRows.push({
      id: userId,
      username: userSeed.username,
      email: userSeed.email,
      password: passwordHash,
      role: userSeed.role,
      createdAt: now,
      updatedAt: now,
    });

    for (const messageSeed of userSeed.messages) {
      messagesRows.push({
        id: crypto.randomUUID(),
        text: messageSeed.text,
        userId,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  await runInTransaction(queryInterface, async (t) => {
    await queryInterface.bulkInsert("users", usersRows, { transaction: t });
    await queryInterface.bulkInsert("messages", messagesRows, {
      transaction: t,
    });
  });
};

/**
 * Reverte o seeder inicial removendo mensagens vinculadas aos usuários iniciais
 * (por userId) e os próprios usuários padrão dentro de uma transação.
 */
export const down = async (queryInterface, Sequelize) => {
  const inOp = Sequelize?.Op?.in || Op.in;
  const usernames = INITIAL_USERS.map((u) => u.username);

  await runInTransaction(queryInterface, async (t) => {
    const users = await models.User.findAll({
      attributes: ["id"],
      where: { username: { [inOp]: usernames } },
      transaction: t,
      raw: true,
    });
    const userIds = users.map((u) => u.id);

    if (userIds.length > 0) {
      await queryInterface.bulkDelete(
        "messages",
        { userId: { [inOp]: userIds } },
        { transaction: t }
      );
    }
    await queryInterface.bulkDelete(
      "users",
      { username: { [inOp]: usernames } },
      { transaction: t }
    );
  });
};

export default { up, down };
