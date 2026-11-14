import crypto from "crypto";
import argon2 from "argon2";
import { Op } from "sequelize";
import models, { sequelize } from "../models/index.js";

export const INITIAL_USERS = [
  {
    username: "rwieruch",
    email: "rwieruch@email.com",
    password: "password123",
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
    password: "password456",
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

  for (const userSeed of INITIAL_USERS) {
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
