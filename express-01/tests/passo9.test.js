import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import argon2 from "argon2";
import { Op } from "sequelize";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecretpassword123";
process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgres://dummy:dummy@localhost:5432/dummy_db";

import models, { sequelize } from "../src/models/index.js";
import sessionService from "../src/services/sessionService.js";
import userService from "../src/services/userService.js";
import {
  AppError,
  cleanExpiredTokens as reexportedCleanExpiredTokens,
  runTokenCleanup as reexportedRunTokenCleanup,
} from "../src/utils/index.js";
import {
  cleanExpiredTokens,
  runTokenCleanup,
  isDirectCliExecution,
} from "../src/utils/tokenCleanup.js";
import seederDefault, {
  up as seederUp,
  down as seederDown,
} from "../src/seeders/20261114000001-initial-users-with-messages.js";
import {
  createUsersWithMessages,
  up as indexSeederUp,
  down as indexSeederDown,
} from "../src/seeders/index.js";

const createManagedTransactionMock = (tx = { id: "mock-tx" }) => {
  const state = { committed: false, rolledBack: false, calls: 0 };
  const transactionImpl = async (callback) => {
    state.calls += 1;
    try {
      const result = await callback(tx);
      state.committed = true;
      return result;
    } catch (error) {
      state.rolledBack = true;
      throw error;
    }
  };
  return { tx, state, transactionImpl };
};

// -------------------------------------------------------------
// 1. Utilitário de Limpeza de Tokens (tokenCleanup)
// -------------------------------------------------------------
test("Fase 9 - utils/index.js reexporta cleanExpiredTokens e runTokenCleanup sem efeitos colaterais", () => {
  assert.equal(reexportedCleanExpiredTokens, cleanExpiredTokens);
  assert.equal(reexportedRunTokenCleanup, runTokenCleanup);
  assert.equal(isDirectCliExecution(), false);
});

test("Fase 9 - isDirectCliExecution detecta execução CLI vs import de app/testes", () => {
  assert.equal(
    isDirectCliExecution({
      nodeEnv: "test",
      execArgv: ["-e", 'import("./src/utils/tokenCleanup.js")'],
      argv: ["node", "/app/src/utils/tokenCleanup.js"],
      moduleUrl: "file:///app/src/utils/tokenCleanup.js",
    }),
    false
  );

  assert.equal(
    isDirectCliExecution({
      nodeEnv: "production",
      execArgv: ["-e", 'import("./src/utils/tokenCleanup.js")'],
      argv: ["node"],
      moduleUrl: "file:///app/src/utils/tokenCleanup.js",
    }),
    true
  );

  assert.equal(
    isDirectCliExecution({
      nodeEnv: "production",
      execArgv: ["-e", 'await import("./src/utils/tokenCleanup");'],
      argv: ["node"],
      moduleUrl: "file:///app/src/utils/tokenCleanup.js",
    }),
    true
  );

  assert.equal(
    isDirectCliExecution({
      nodeEnv: "production",
      execArgv: ["-e", 'import("./src/utils/tokenCleanup.js").then(fn)'],
      argv: ["node"],
      moduleUrl: "file:///app/src/utils/tokenCleanup.js",
    }),
    false
  );

  assert.equal(
    isDirectCliExecution({
      nodeEnv: "production",
      execArgv: ["-e", 'console.log("tokenCleanup")'],
      argv: ["node"],
      moduleUrl: "file:///app/src/utils/tokenCleanup.js",
    }),
    false
  );

  assert.equal(
    isDirectCliExecution({
      nodeEnv: "development",
      execArgv: [],
      argv: ["node", "/app/src/utils/tokenCleanup.js"],
      moduleUrl: "file:///app/src/utils/tokenCleanup.js",
    }),
    true
  );

  assert.equal(
    isDirectCliExecution({
      nodeEnv: "production",
      execArgv: [],
      argv: ["node", "/app/src/index.js"],
      moduleUrl: "file:///app/src/utils/tokenCleanup.js",
    }),
    false
  );

  assert.equal(
    isDirectCliExecution({
      nodeEnv: "production",
      execArgv: [],
      argv: ["node"],
      moduleUrl: "file:///app/src/utils/tokenCleanup.js",
    }),
    false
  );
});

test("Fase 9 - cleanExpiredTokens remove tokens com expiresAt < referenceDate e retorna total", async () => {
  const originalDestroy = models.RefreshToken.destroy;
  const referenceDate = new Date("2026-11-14T12:00:00.000Z");
  let capturedWhere = null;

  models.RefreshToken.destroy = async ({ where }) => {
    capturedWhere = where;
    return 4;
  };

  try {
    const deletedCount = await cleanExpiredTokens(referenceDate);
    assert.equal(deletedCount, 4);
    assert.equal(capturedWhere.expiresAt[Op.lt], referenceDate);
  } finally {
    models.RefreshToken.destroy = originalDestroy;
  }
});

test("Fase 9 - runTokenCleanup registra sucesso e respeita closeConnection: true e false", async () => {
  const originalDestroy = models.RefreshToken.destroy;
  const originalClose = sequelize.close;

  let destroyCalls = 0;
  let closeCalls = 0;
  const logs = [];
  const errors = [];
  const mockLogger = {
    log: (...args) => logs.push(args.join(" ")),
    error: (...args) => errors.push(args.join(" ")),
  };

  models.RefreshToken.destroy = async () => {
    destroyCalls += 1;
    return 2;
  };
  sequelize.close = async () => {
    closeCalls += 1;
  };

  try {
    const firstResult = await runTokenCleanup({ logger: mockLogger });
    assert.equal(firstResult, 2);
    assert.equal(destroyCalls, 1);
    assert.equal(closeCalls, 1);
    assert.equal(errors.length, 0);
    assert.ok(logs[0].includes("2 refresh token(s)"));

    const secondResult = await runTokenCleanup({
      closeConnection: false,
      logger: mockLogger,
    });
    assert.equal(secondResult, 2);
    assert.equal(destroyCalls, 2);
    assert.equal(closeCalls, 1);
  } finally {
    models.RefreshToken.destroy = originalDestroy;
    sequelize.close = originalClose;
  }
});

test("Fase 9 - runTokenCleanup captura erro, define process.exitCode = 1 e fecha conexão no finally", async () => {
  const originalDestroy = models.RefreshToken.destroy;
  const originalClose = sequelize.close;
  const originalExitCode = process.exitCode;

  let closeCalls = 0;
  const errors = [];
  const mockLogger = {
    log: () => {},
    error: (...args) => errors.push(args),
  };

  models.RefreshToken.destroy = async () => {
    throw new Error("Falha de conexão simulada");
  };
  sequelize.close = async () => {
    closeCalls += 1;
  };

  try {
    process.exitCode = undefined;
    const result = await runTokenCleanup({
      closeConnection: true,
      logger: mockLogger,
    });

    assert.equal(result, undefined);
    assert.equal(process.exitCode, 1);
    assert.equal(closeCalls, 1);
    assert.equal(errors.length, 1);

    process.exitCode = undefined;
    await runTokenCleanup({ closeConnection: false, logger: mockLogger });
    assert.equal(process.exitCode, 1);
    assert.equal(closeCalls, 1);
  } finally {
    models.RefreshToken.destroy = originalDestroy;
    sequelize.close = originalClose;
    process.exitCode = originalExitCode;
  }
});

// -------------------------------------------------------------
// 2. Transações Gerenciadas em sessionService e userService
// -------------------------------------------------------------
test("Fase 9 - sessionService: createRefreshToken e destroyUserRefreshTokens propagam transaction opcional", async () => {
  const originalCreate = models.RefreshToken.create;
  const originalDestroy = models.RefreshToken.destroy;
  const mockTx = { id: "tx-opt" };

  let capturedCreateOpts = null;
  let capturedDestroyOpts = null;

  models.RefreshToken.create = async (_data, opts) => {
    capturedCreateOpts = opts;
    return {};
  };
  models.RefreshToken.destroy = async (opts) => {
    capturedDestroyOpts = opts;
    return 1;
  };

  try {
    await sessionService.createRefreshToken("u-1", null, {
      transaction: mockTx,
    });
    assert.equal(capturedCreateOpts.transaction, mockTx);

    await sessionService.createRefreshToken("u-1");
    assert.equal(capturedCreateOpts.transaction, undefined);

    await sessionService.destroyUserRefreshTokens("u-1", {
      transaction: mockTx,
    });
    assert.equal(capturedDestroyOpts.transaction, mockTx);

    await sessionService.destroyUserRefreshTokens("u-1");
    assert.equal(capturedDestroyOpts.transaction, undefined);
  } finally {
    models.RefreshToken.create = originalCreate;
    models.RefreshToken.destroy = originalDestroy;
  }
});

test("Fase 9 - sessionService.rotateRefreshToken: usa lock FOR UPDATE OF na transação, trata usuário órfão com commit e realiza rollback quando criação falha", async () => {
  const originalFindOne = models.RefreshToken.findOne;
  const originalFindByPk = models.User.findByPk;
  const originalDestroy = models.RefreshToken.destroy;
  const originalCreate = models.RefreshToken.create;
  const originalTransaction = sequelize.transaction;

  // Caso 1: usuário órfão (!dbToken.user) destrói token dentro da transação (commit) e rejeita com 401
  const txOrphan = createManagedTransactionMock({
    id: "tx-rotate-orphan",
    LOCK: { UPDATE: "UPDATE" },
  });
  let orphanDestroyOpts = null;
  let findOneOpts = null;

  sequelize.transaction = txOrphan.transactionImpl;
  models.RefreshToken.findOne = async (opts) => {
    findOneOpts = opts;
    return {
      id: "rt-orphan",
      expiresAt: new Date(Date.now() + 60000),
      user: null,
      async destroy(opts) {
        orphanDestroyOpts = opts;
      },
    };
  };

  try {
    await assert.rejects(
      async () => {
        await sessionService.rotateRefreshToken("e".repeat(80));
      },
      (err) => err instanceof AppError && err.statusCode === 401
    );
    assert.equal(findOneOpts.transaction, txOrphan.tx);
    assert.deepEqual(findOneOpts.lock, {
      level: "UPDATE",
      of: models.RefreshToken,
    });
    assert.equal(orphanDestroyOpts?.transaction, txOrphan.tx);
    assert.equal(txOrphan.state.committed, true);
    assert.equal(txOrphan.state.rolledBack, false);

    // Caso 2: erro na criação do novo token faz rollback completo da transação
    const { tx, state, transactionImpl } = createManagedTransactionMock({
      id: "tx-rotate-rb",
      LOCK: { UPDATE: "UPDATE" },
    });
    let destroyTx = null;
    let lockedUserOpts = null;

    sequelize.transaction = transactionImpl;
    models.RefreshToken.findOne = async () => ({
      id: "rt-1",
      expiresAt: new Date(Date.now() + 60000),
      user: { id: "u-1", username: "alice", email: "alice@unicap.br", role: "USER" },
    });
    models.User.findByPk = async (_id, opts) => {
      lockedUserOpts = opts;
      return { id: "u-1", username: "alice", email: "alice@unicap.br", role: "USER" };
    };
    models.RefreshToken.destroy = async (opts) => {
      destroyTx = opts.transaction;
      return 1;
    };
    models.RefreshToken.create = async () => {
      throw new Error("Erro ao inserir novo refresh token");
    };

    await assert.rejects(
      async () => {
        await sessionService.rotateRefreshToken("d".repeat(80));
      },
      { message: "Erro ao inserir novo refresh token" }
    );
    assert.deepEqual(lockedUserOpts, { transaction: tx, lock: "UPDATE" });
    assert.equal(destroyTx, tx);
    assert.equal(state.rolledBack, true);
    assert.equal(state.committed, false);
  } finally {
    models.RefreshToken.findOne = originalFindOne;
    models.User.findByPk = originalFindByPk;
    models.RefreshToken.destroy = originalDestroy;
    models.RefreshToken.create = originalCreate;
    sequelize.transaction = originalTransaction;
  }
});

test("Fase 9 - userService.createUser: cria usuário com/sem mensagens em transação, reutiliza options.transaction e faz rollback", async () => {
  const originalCreate = models.User.create;
  const originalTransaction = sequelize.transaction;

  const calls = [];
  models.User.create = async (payload, options) => {
    calls.push({ payload, options });
    return { id: "new-user-id", ...payload };
  };

  try {
    // 1) Sem messages: abre transação própria e ignora role indevido
    const tx1 = createManagedTransactionMock({ id: "tx-create-1" });
    sequelize.transaction = tx1.transactionImpl;
    const created1 = await userService.createUser({
      username: "maria",
      email: "maria@unicap.br",
      password: "password123",
      role: "ADMIN",
    });
    assert.equal(created1.username, "maria");
    assert.equal(tx1.state.committed, true);
    assert.equal(calls[0].payload.role, undefined);
    assert.equal(calls[0].options.include, undefined);
    assert.equal(calls[0].options.transaction, tx1.tx);

    // 2) Com messages: inclui models.Message na mesma transação
    const tx2 = createManagedTransactionMock({ id: "tx-create-2" });
    sequelize.transaction = tx2.transactionImpl;
    await userService.createUser({
      username: "joao",
      email: "joao@unicap.br",
      password: "password123",
      messages: [{ text: "Olá mundo" }],
    });
    assert.equal(tx2.state.committed, true);
    assert.deepEqual(calls[1].options.include, [models.Message]);
    assert.equal(calls[1].options.transaction, tx2.tx);

    // 3) Com options.transaction: reutiliza transação externa sem chamar sequelize.transaction
    let externalTxCalled = false;
    sequelize.transaction = async () => {
      externalTxCalled = true;
    };
    const externalTx = { id: "tx-external" };
    await userService.createUser(
      {
        username: "lucas",
        email: "lucas@unicap.br",
        password: "password123",
      },
      { transaction: externalTx }
    );
    assert.equal(externalTxCalled, false);
    assert.equal(calls[2].options.transaction, externalTx);

    // 4) Falha na criação provoca rollback
    const tx4 = createManagedTransactionMock({ id: "tx-create-rb" });
    sequelize.transaction = tx4.transactionImpl;
    models.User.create = async () => {
      throw new Error("Falha ao criar usuário");
    };
    await assert.rejects(
      async () => {
        await userService.createUser({
          username: "erro",
          email: "erro@unicap.br",
          password: "password123",
        });
      },
      { message: "Falha ao criar usuário" }
    );
    assert.equal(tx4.state.rolledBack, true);
    assert.equal(tx4.state.committed, false);
  } finally {
    models.User.create = originalCreate;
    sequelize.transaction = originalTransaction;
  }
});

test("Fase 9 - userService.updateUser: lê usuário com lock FOR UPDATE na transação, retorna null se inexistente e faz rollback se revogação falhar", async () => {
  const originalFindByPk = models.User.findByPk;
  const originalDestroyUserRefreshTokens =
    sessionService.destroyUserRefreshTokens;
  const originalTransaction = sequelize.transaction;

  const txNotFound = createManagedTransactionMock({
    id: "tx-not-found",
    LOCK: { UPDATE: "UPDATE" },
  });
  sequelize.transaction = txNotFound.transactionImpl;
  let capturedFindArgs = null;
  models.User.findByPk = async (...args) => {
    capturedFindArgs = args;
    return null;
  };

  try {
    // Chamada direta a getUserById sem options preserva comportamento sem queryOptions
    await userService.getUserById("u-direct");
    assert.deepEqual(capturedFindArgs, ["u-direct"]);

    const missing = await userService.updateUser("u-inexistente", {
      username: "x",
    });
    assert.equal(missing, null);
    assert.equal(txNotFound.state.calls, 1);
    assert.equal(txNotFound.state.committed, true);
    assert.deepEqual(capturedFindArgs, [
      "u-inexistente",
      { transaction: txNotFound.tx, lock: "UPDATE" },
    ]);

    const txRollback = createManagedTransactionMock({
      id: "tx-update-rb",
      LOCK: { UPDATE: "UPDATE" },
    });
    sequelize.transaction = txRollback.transactionImpl;
    let findByPkOpts = null;
    let updateTx = null;
    let revokeTx = null;

    models.User.findByPk = async (_id, opts) => {
      findByPkOpts = opts;
      return {
        id: "u-1",
        role: "USER",
        async update(fields, options) {
          updateTx = options.transaction;
          return { ...this, ...fields };
        },
      };
    };
    sessionService.destroyUserRefreshTokens = async (_id, options) => {
      revokeTx = options.transaction;
      throw new Error("Falha ao revogar tokens");
    };

    await assert.rejects(
      async () => {
        await userService.updateUser(
          "u-1",
          { role: "ADMIN" },
          { id: "admin-1", role: "ADMIN" }
        );
      },
      { message: "Falha ao revogar tokens" }
    );

    assert.deepEqual(findByPkOpts, {
      transaction: txRollback.tx,
      lock: "UPDATE",
    });
    assert.equal(updateTx, txRollback.tx);
    assert.equal(revokeTx, txRollback.tx);
    assert.equal(txRollback.state.rolledBack, true);
    assert.equal(txRollback.state.committed, false);
  } finally {
    models.User.findByPk = originalFindByPk;
    sessionService.destroyUserRefreshTokens = originalDestroyUserRefreshTokens;
    sequelize.transaction = originalTransaction;
  }
});

test("Fase 9 - userService.deleteUser: executa destruição em transação e retorna booleano", async () => {
  const originalDestroy = models.User.destroy;
  const originalTransaction = sequelize.transaction;

  try {
    const tx1 = createManagedTransactionMock({ id: "tx-del-1" });
    sequelize.transaction = tx1.transactionImpl;
    let capturedOpts = null;
    models.User.destroy = async (opts) => {
      capturedOpts = opts;
      return 1;
    };

    const deleted = await userService.deleteUser("u-1");
    assert.equal(deleted, true);
    assert.deepEqual(capturedOpts.where, { id: "u-1" });
    assert.equal(capturedOpts.transaction, tx1.tx);
    assert.equal(tx1.state.committed, true);

    const tx2 = createManagedTransactionMock({ id: "tx-del-2" });
    sequelize.transaction = tx2.transactionImpl;
    models.User.destroy = async () => 0;
    const notDeleted = await userService.deleteUser("u-2");
    assert.equal(notDeleted, false);
    assert.equal(tx2.state.committed, true);
  } finally {
    models.User.destroy = originalDestroy;
    sequelize.transaction = originalTransaction;
  }
});

// -------------------------------------------------------------
// 3. Seeders Oficiais e Desacoplamento de src/index.js
// -------------------------------------------------------------
test("Fase 9 - seeders/index.js: createUsersWithMessages cria rwieruch e ddavids atomicamente com rollback em falha", async () => {
  const originalCreate = models.User.create;
  const originalTransaction = sequelize.transaction;

  assert.equal(indexSeederUp, seederUp);
  assert.equal(indexSeederDown, seederDown);

  try {
    const txOk = createManagedTransactionMock({ id: "tx-seed-ok" });
    sequelize.transaction = txOk.transactionImpl;
    const createdCalls = [];
    models.User.create = async (data, options) => {
      createdCalls.push({ data, options });
      return data;
    };

    const users = await createUsersWithMessages();
    assert.equal(users.length, 2);
    assert.equal(txOk.state.committed, true);
    assert.equal(createdCalls[0].data.username, "rwieruch");
    assert.equal(createdCalls[0].data.role, "ADMIN");
    assert.equal(createdCalls[0].data.messages.length, 1);
    assert.deepEqual(createdCalls[0].options.include, [models.Message]);
    assert.equal(createdCalls[0].options.transaction, txOk.tx);

    assert.equal(createdCalls[1].data.username, "ddavids");
    assert.equal(createdCalls[1].data.role, "USER");
    assert.equal(createdCalls[1].data.messages.length, 2);
    assert.deepEqual(createdCalls[1].options.include, [models.Message]);
    assert.equal(createdCalls[1].options.transaction, txOk.tx);

    // Simula falha no segundo insert para garantir rollback transacional
    const txFail = createManagedTransactionMock({ id: "tx-seed-fail" });
    sequelize.transaction = txFail.transactionImpl;
    let count = 0;
    models.User.create = async () => {
      count += 1;
      if (count === 2) {
        throw new Error("Erro ao inserir ddavids");
      }
      return {};
    };

    await assert.rejects(
      async () => {
        await createUsersWithMessages();
      },
      { message: "Erro ao inserir ddavids" }
    );
    assert.equal(txFail.state.rolledBack, true);
    assert.equal(txFail.state.committed, false);
  } finally {
    models.User.create = originalCreate;
    sequelize.transaction = originalTransaction;
  }
});

test("Fase 9 - seeder oficial Sequelize CLI (up/down) usa transação, hashes Argon2, UUIDs e remoção por userId", async () => {
  const originalTransaction = sequelize.transaction;
  const originalFindAll = models.User.findAll;
  const originalAdminPassword = process.env.ADMIN_PASSWORD;
  const originalUserPassword = process.env.USER_PASSWORD;
  process.env.ADMIN_PASSWORD = "seed-admin-test-pass";
  process.env.USER_PASSWORD = "seed-user-test-pass";

  assert.equal(seederDefault.up, seederUp);
  assert.equal(seederDefault.down, seederDown);

  const inserted = [];
  const deleted = [];
  let findAllOpts = null;
  const txCli = createManagedTransactionMock({ id: "tx-cli-seed" });

  const mockQueryInterfaceWithTx = {
    sequelize: {
      transaction: txCli.transactionImpl,
    },
    async bulkInsert(table, rows, options) {
      inserted.push({ table, rows, options });
    },
    async bulkDelete(table, where, options) {
      deleted.push({ table, where, options });
    },
  };

  try {
    await seederUp(mockQueryInterfaceWithTx, { Op });
    assert.equal(txCli.state.committed, true);
    assert.equal(inserted.length, 2);
    assert.equal(inserted[0].table, "users");
    assert.equal(inserted[0].options.transaction, txCli.tx);
    assert.equal(inserted[0].rows.length, 2);

    const [rwieruchRow, ddavidsRow] = inserted[0].rows;
    assert.match(rwieruchRow.id, /^[0-9a-f-]{36}$/i);
    assert.equal(rwieruchRow.role, "ADMIN");
    assert.ok(rwieruchRow.createdAt instanceof Date);
    assert.ok(rwieruchRow.updatedAt instanceof Date);
    assert.equal(
      await argon2.verify(rwieruchRow.password, "seed-admin-test-pass"),
      true
    );

    assert.match(ddavidsRow.id, /^[0-9a-f-]{36}$/i);
    assert.equal(ddavidsRow.role, "USER");
    assert.equal(
      await argon2.verify(ddavidsRow.password, "seed-user-test-pass"),
      true
    );

    assert.equal(inserted[1].table, "messages");
    assert.equal(inserted[1].options.transaction, txCli.tx);
    assert.equal(inserted[1].rows.length, 3);
    assert.equal(inserted[1].rows[0].userId, rwieruchRow.id);
    assert.equal(inserted[1].rows[1].userId, ddavidsRow.id);
    assert.equal(inserted[1].rows[2].userId, ddavidsRow.id);

    models.User.findAll = async (opts) => {
      findAllOpts = opts;
      return [{ id: rwieruchRow.id }, { id: ddavidsRow.id }];
    };

    await seederDown(mockQueryInterfaceWithTx, { Op });
    assert.deepEqual(findAllOpts.attributes, ["id"]);
    assert.deepEqual(findAllOpts.where.username[Op.in], [
      "rwieruch",
      "ddavids",
    ]);
    assert.equal(findAllOpts.transaction, txCli.tx);
    assert.equal(findAllOpts.raw, true);

    assert.equal(deleted.length, 2);
    assert.equal(deleted[0].table, "messages");
    assert.equal(deleted[0].options.transaction, txCli.tx);
    assert.deepEqual(deleted[0].where.userId[Op.in], [
      rwieruchRow.id,
      ddavidsRow.id,
    ]);
    assert.equal(deleted[1].table, "users");
    assert.equal(deleted[1].options.transaction, txCli.tx);
    assert.deepEqual(deleted[1].where.username[Op.in], [
      "rwieruch",
      "ddavids",
    ]);

    // Fallback para sequelize.transaction e Op quando queryInterface.sequelize, Sequelize ou usuários não existem
    const txFallback = createManagedTransactionMock({ id: "tx-fallback" });
    sequelize.transaction = txFallback.transactionImpl;
    models.User.findAll = async () => [];
    const fallbackCalls = [];
    const minimalQueryInterface = {
      async bulkInsert(table, rows, options) {
        fallbackCalls.push({ op: "insert", table, rows, options });
      },
      async bulkDelete(table, where, options) {
        fallbackCalls.push({ op: "delete", table, where, options });
      },
    };
    await seederUp(minimalQueryInterface);
    await seederDown(minimalQueryInterface);
    assert.equal(txFallback.state.calls, 2);
    assert.equal(fallbackCalls[0].options.transaction, txFallback.tx);
    assert.equal(
      fallbackCalls.filter((c) => c.op === "delete").length,
      1,
      "Quando não há usuários iniciais, down deve executar apenas bulkDelete em users"
    );
    assert.equal(fallbackCalls[2].table, "users");
    assert.equal(fallbackCalls[2].options.transaction, txFallback.tx);
  } finally {
    models.User.findAll = originalFindAll;
    sequelize.transaction = originalTransaction;
    if (originalAdminPassword === undefined) {
      delete process.env.ADMIN_PASSWORD;
    } else {
      process.env.ADMIN_PASSWORD = originalAdminPassword;
    }
    if (originalUserPassword === undefined) {
      delete process.env.USER_PASSWORD;
    } else {
      process.env.USER_PASSWORD = originalUserPassword;
    }
  }
});

test("Fase 9 - src/index.js importa createUsersWithMessages de ./seeders/index.js sem definição inline", async () => {
  const indexPath = path.resolve(process.cwd(), "src/index.js");
  const source = await fs.readFile(indexPath, "utf8");

  assert.ok(
    source.includes('from "./seeders/index.js"'),
    "src/index.js deve importar seeder de ./seeders/index.js"
  );
  assert.equal(
    source.includes("const createUsersWithMessages"),
    false,
    "src/index.js não deve manter definição inline de createUsersWithMessages"
  );
});
