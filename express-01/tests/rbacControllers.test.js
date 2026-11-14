import test from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecretpassword123";
process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgres://dummy:dummy@localhost:5432/dummy_db";

import userController from "../src/controllers/userController.js";
import messageController from "../src/controllers/messageController.js";
import {
  userService,
  messageService,
  sessionService,
} from "../src/services/index.js";
import models, { sequelize } from "../src/models/index.js";
import { AppError } from "../src/utils/index.js";

const createMockRes = () => {
  const res = {
    statusCode: null,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
};

// -------------------------------------------------------------
// Prevenção contra Escalação de Privilégios (userController)
// -------------------------------------------------------------
test("Fase 8 - userController.updateUser: bloqueia com 403 quando usuário comum tenta alterar o próprio role", async () => {
  const originalUpdateUser = userService.updateUser;
  let serviceCalled = false;
  userService.updateUser = async () => {
    serviceCalled = true;
    return null;
  };

  try {
    const req = {
      params: { userId: "u-1" },
      body: { role: "ADMIN" },
      context: { me: { id: "u-1", role: "USER" } },
    };
    const res = createMockRes();

    await assert.rejects(
      async () => {
        await userController.updateUser(req, res);
      },
      (err) =>
        err instanceof AppError &&
        err.statusCode === 403 &&
        err.message === "Apenas administradores podem alterar perfis de acesso."
    );
    assert.equal(serviceCalled, false);
  } finally {
    userService.updateUser = originalUpdateUser;
  }
});

test("Fase 8 - userController.updateUser: permite que ADMIN altere o role de um usuário", async () => {
  const originalUpdateUser = userService.updateUser;
  let capturedPayload = null;
  const updatedUser = {
    id: "u-2",
    username: "bob",
    email: "bob@unicap.br",
    role: "ADMIN",
  };
  userService.updateUser = async (id, data, actor) => {
    capturedPayload = { id, data, actor };
    return updatedUser;
  };

  try {
    const req = {
      params: { userId: "u-2" },
      body: { role: "ADMIN" },
      context: { me: { id: "admin-1", role: "ADMIN" } },
    };
    const res = createMockRes();

    await userController.updateUser(req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, updatedUser);
    assert.equal(capturedPayload.id, "u-2");
    assert.equal(capturedPayload.data.role, "ADMIN");
    assert.deepEqual(capturedPayload.actor, { id: "admin-1", role: "ADMIN" });
  } finally {
    userService.updateUser = originalUpdateUser;
  }
});

test("Fase 8 - userController.updateUser: permite que USER atualize próprios dados sem enviar role", async () => {
  const originalUpdateUser = userService.updateUser;
  let capturedPayload = null;
  const updatedUser = {
    id: "u-1",
    username: "alice_novo",
    email: "alice@unicap.br",
    role: "USER",
  };
  userService.updateUser = async (id, data, actor) => {
    capturedPayload = { id, data, actor };
    return updatedUser;
  };

  try {
    const req = {
      params: { userId: "u-1" },
      body: { username: "alice_novo" },
      context: { me: { id: "u-1", role: "USER" } },
    };
    const res = createMockRes();

    await userController.updateUser(req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, updatedUser);
    assert.equal(capturedPayload.data.username, "alice_novo");
    assert.equal(capturedPayload.data.role, undefined);
    assert.deepEqual(capturedPayload.actor, { id: "u-1", role: "USER" });
  } finally {
    userService.updateUser = originalUpdateUser;
  }
});

test("Fase 8 - userController.createUser: ignora campo role enviado no cadastro público", async () => {
  const originalCreateUser = userService.createUser;
  let capturedData = null;
  userService.createUser = async (data) => {
    capturedData = data;
    return { id: "u-new", ...data, role: "USER" };
  };

  try {
    const req = {
      body: {
        username: "atacante",
        email: "atacante@unicap.br",
        password: "password123",
        role: "ADMIN",
      },
    };
    const res = createMockRes();

    await userController.createUser(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(capturedData.role, undefined);
    assert.equal(res.body.role, "USER");
  } finally {
    userService.createUser = originalCreateUser;
  }
});

// -------------------------------------------------------------
// Reuso de req.message (messageController)
// -------------------------------------------------------------
test("Fase 8 - messageController.updateMessage: repassa req.message para evitar consulta duplicada", async () => {
  const originalUpdateMessage = messageService.updateMessage;
  const mockExistingMessage = { id: "msg-1", text: "Antigo", userId: "u-1" };
  let capturedExistingMessage = null;

  messageService.updateMessage = async (id, data, existingMessage) => {
    capturedExistingMessage = existingMessage;
    return { ...mockExistingMessage, text: data.text };
  };

  try {
    const req = {
      params: { messageId: "msg-1" },
      body: { text: "Novo texto" },
      message: mockExistingMessage,
    };
    const res = createMockRes();

    await messageController.updateMessage(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.text, "Novo texto");
    assert.equal(capturedExistingMessage, mockExistingMessage);
  } finally {
    messageService.updateMessage = originalUpdateMessage;
  }
});

// -------------------------------------------------------------
// Defesa em Profundidade e Revogação de Refresh Tokens em userService.updateUser
// -------------------------------------------------------------
test("Fase 8 - userService.updateUser: bloqueia com 403 quando role é informado sem actor ADMIN (fail-safe)", async () => {
  const originalFindByPk = models.User.findByPk;
  let dbQueried = false;
  models.User.findByPk = async () => {
    dbQueried = true;
    return null;
  };

  try {
    // Sem actor (chamada direta sem contexto administrativo)
    await assert.rejects(
      async () => {
        await userService.updateUser("u-1", { role: "ADMIN" });
      },
      (err) =>
        err instanceof AppError &&
        err.statusCode === 403 &&
        err.message === "Apenas administradores podem alterar perfis de acesso."
    );

    // Com actor de perfil USER
    await assert.rejects(
      async () => {
        await userService.updateUser(
          "u-1",
          { role: "ADMIN" },
          { id: "u-1", role: "USER" }
        );
      },
      (err) =>
        err instanceof AppError &&
        err.statusCode === 403 &&
        err.message === "Apenas administradores podem alterar perfis de acesso."
    );

    assert.equal(dbQueried, false);
  } finally {
    models.User.findByPk = originalFindByPk;
  }
});

test("Fase 8 - userService.updateUser: revoga refresh tokens quando ADMIN altera efetivamente o role", async () => {
  const originalFindByPk = models.User.findByPk;
  const originalDestroyUserRefreshTokens =
    sessionService.destroyUserRefreshTokens;
  const originalTransaction = sequelize.transaction;

  const mockTx = { id: "tx-role-change", LOCK: { UPDATE: "UPDATE" } };
  let findByPkOpts = null;
  let revokedUserId = null;
  let revokedOptions = null;
  let updatedFields = null;
  let updatedOptions = null;

  const mockUserInstance = {
    id: "u-1",
    username: "alice",
    role: "USER",
    async update(fields, options) {
      updatedFields = fields;
      updatedOptions = options;
      return { ...this, ...fields };
    },
  };

  sequelize.transaction = async (callback) => await callback(mockTx);
  models.User.findByPk = async (id, opts) => {
    findByPkOpts = opts;
    return id === "u-1" ? mockUserInstance : null;
  };
  sessionService.destroyUserRefreshTokens = async (userId, options) => {
    revokedUserId = userId;
    revokedOptions = options;
  };

  try {
    const updated = await userService.updateUser(
      "u-1",
      { role: "ADMIN" },
      { id: "admin-1", role: "ADMIN" }
    );

    assert.equal(updated.role, "ADMIN");
    assert.deepEqual(findByPkOpts, { transaction: mockTx, lock: "UPDATE" });
    assert.deepEqual(updatedFields, { role: "ADMIN" });
    assert.equal(updatedOptions?.transaction, mockTx);
    assert.equal(revokedUserId, "u-1");
    assert.equal(revokedOptions?.transaction, mockTx);
  } finally {
    models.User.findByPk = originalFindByPk;
    sessionService.destroyUserRefreshTokens = originalDestroyUserRefreshTokens;
    sequelize.transaction = originalTransaction;
  }
});

test("Fase 8 - userService.updateUser: não revoga refresh tokens quando ADMIN envia o mesmo role atual", async () => {
  const originalFindByPk = models.User.findByPk;
  const originalDestroyUserRefreshTokens =
    sessionService.destroyUserRefreshTokens;
  const originalTransaction = sequelize.transaction;

  const mockTx = { id: "tx-same-role", LOCK: { UPDATE: "UPDATE" } };
  let findByPkOpts = null;
  let revokeCalled = false;
  let updatedFields = null;
  let updatedOptions = null;

  const mockUserInstance = {
    id: "u-1",
    username: "alice",
    role: "USER",
    async update(fields, options) {
      updatedFields = fields;
      updatedOptions = options;
      return { ...this, ...fields };
    },
  };

  sequelize.transaction = async (callback) => await callback(mockTx);
  models.User.findByPk = async (id, opts) => {
    findByPkOpts = opts;
    return id === "u-1" ? mockUserInstance : null;
  };
  sessionService.destroyUserRefreshTokens = async () => {
    revokeCalled = true;
  };

  try {
    const updated = await userService.updateUser(
      "u-1",
      { username: "alice_edit", role: "USER" },
      { id: "admin-1", role: "ADMIN" }
    );

    assert.equal(updated.username, "alice_edit");
    assert.equal(updated.role, "USER");
    assert.deepEqual(findByPkOpts, { transaction: mockTx, lock: "UPDATE" });
    assert.deepEqual(updatedFields, { username: "alice_edit", role: "USER" });
    assert.equal(updatedOptions?.transaction, mockTx);
    assert.equal(revokeCalled, false);
  } finally {
    models.User.findByPk = originalFindByPk;
    sessionService.destroyUserRefreshTokens = originalDestroyUserRefreshTokens;
    sequelize.transaction = originalTransaction;
  }
});

test("Fase 8 - userService.updateUser: revoga refresh tokens quando password é alterado", async () => {
  const originalFindByPk = models.User.findByPk;
  const originalDestroyUserRefreshTokens =
    sessionService.destroyUserRefreshTokens;
  const originalTransaction = sequelize.transaction;

  const mockTx = { id: "tx-pw-change", LOCK: { UPDATE: "UPDATE" } };
  let findByPkOpts = null;
  let revokedUserId = null;
  let revokedOptions = null;
  let updatedOptions = null;

  const mockUserInstance = {
    id: "u-1",
    username: "alice",
    role: "USER",
    async update(fields, options) {
      updatedOptions = options;
      return { ...this, ...fields };
    },
  };

  sequelize.transaction = async (callback) => await callback(mockTx);
  models.User.findByPk = async (id, opts) => {
    findByPkOpts = opts;
    return id === "u-1" ? mockUserInstance : null;
  };
  sessionService.destroyUserRefreshTokens = async (userId, options) => {
    revokedUserId = userId;
    revokedOptions = options;
  };

  try {
    await userService.updateUser("u-1", { password: "newpassword123" });
    assert.deepEqual(findByPkOpts, { transaction: mockTx, lock: "UPDATE" });
    assert.equal(updatedOptions?.transaction, mockTx);
    assert.equal(revokedUserId, "u-1");
    assert.equal(revokedOptions?.transaction, mockTx);
  } finally {
    models.User.findByPk = originalFindByPk;
    sessionService.destroyUserRefreshTokens = originalDestroyUserRefreshTokens;
    sequelize.transaction = originalTransaction;
  }
});

test("Fase 8 - userService.updateUser: não revoga refresh tokens quando apenas username é alterado", async () => {
  const originalFindByPk = models.User.findByPk;
  const originalDestroyUserRefreshTokens =
    sessionService.destroyUserRefreshTokens;
  const originalTransaction = sequelize.transaction;

  const mockTx = { id: "tx-username-only", LOCK: { UPDATE: "UPDATE" } };
  let findByPkOpts = null;
  let revokeCalled = false;
  let updatedFields = null;
  let updatedOptions = null;

  const mockUserInstance = {
    id: "u-1",
    username: "alice",
    role: "USER",
    async update(fields, options) {
      updatedFields = fields;
      updatedOptions = options;
      return { ...this, ...fields };
    },
  };

  sequelize.transaction = async (callback) => await callback(mockTx);
  models.User.findByPk = async (id, opts) => {
    findByPkOpts = opts;
    return id === "u-1" ? mockUserInstance : null;
  };
  sessionService.destroyUserRefreshTokens = async () => {
    revokeCalled = true;
  };

  try {
    const updated = await userService.updateUser("u-1", { username: "novo" });

    assert.equal(updated.username, "novo");
    assert.deepEqual(findByPkOpts, { transaction: mockTx, lock: "UPDATE" });
    assert.deepEqual(updatedFields, { username: "novo" });
    assert.equal(updatedOptions?.transaction, mockTx);
    assert.equal(revokeCalled, false);
  } finally {
    models.User.findByPk = originalFindByPk;
    sessionService.destroyUserRefreshTokens = originalDestroyUserRefreshTokens;
    sequelize.transaction = originalTransaction;
  }
});
