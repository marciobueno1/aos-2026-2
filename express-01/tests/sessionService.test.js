import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecretpassword123";

import sessionService from "../src/services/sessionService.js";
import models, { sequelize } from "../src/models/index.js";
import { AppError } from "../src/utils/index.js";

test("Fase 7 - sessionService: createAccessToken gera JWT válido com claims do usuário", () => {
  const user = {
    id: "user-123",
    username: "alice",
    email: "alice@unicap.br",
    role: "ADMIN",
  };

  const token = sessionService.createAccessToken(user);
  assert.ok(typeof token === "string" && token.length > 20);

  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  assert.equal(decoded.id, user.id);
  assert.equal(decoded.username, user.username);
  assert.equal(decoded.email, user.email);
  assert.equal(decoded.role, user.role);
  // Verifica expiração (~15 minutos a partir do iat)
  assert.ok(decoded.exp - decoded.iat <= 15 * 60);
});

test("Fase 7 - sessionService: authenticate lança AppError 401 com credenciais inválidas (usuário inexistente)", async () => {
  const originalFindByLogin = models.User.findByLogin;
  models.User.findByLogin = async () => null;

  try {
    await assert.rejects(
      async () => {
        await sessionService.authenticate("usuario_inexistente", "senha123");
      },
      (err) => {
        return err instanceof AppError && err.statusCode === 401 && err.message === "Credenciais inválidas.";
      }
    );
  } finally {
    models.User.findByLogin = originalFindByLogin;
  }
});

test("Fase 7 - sessionService: authenticate lança AppError 401 quando senha está incorreta", async () => {
  const originalFindByLogin = models.User.findByLogin;
  models.User.findByLogin = async () => ({
    validatePassword: async () => false,
  });

  try {
    await assert.rejects(
      async () => {
        await sessionService.authenticate("alice", "senha_errada");
      },
      (err) => {
        return err instanceof AppError && err.statusCode === 401 && err.message === "Credenciais inválidas.";
      }
    );
  } finally {
    models.User.findByLogin = originalFindByLogin;
  }
});

test("Fase 7 - sessionService: rotateRefreshToken rejeita token inexistente com 401", async () => {
  const originalFindOne = models.RefreshToken.findOne;
  const originalTransaction = sequelize.transaction;
  const mockTx = { id: "tx-missing", LOCK: { UPDATE: "UPDATE" } };
  let findOneOpts = null;

  sequelize.transaction = async (callback) => await callback(mockTx);
  models.RefreshToken.findOne = async (opts) => {
    findOneOpts = opts;
    return null;
  };

  try {
    await assert.rejects(
      async () => {
        await sessionService.rotateRefreshToken("token_inexistente");
      },
      (err) => {
        return (
          err instanceof AppError &&
          err.statusCode === 401 &&
          err.message === "Refresh token inválido ou expirado."
        );
      }
    );
    assert.equal(findOneOpts.transaction, mockTx);
    assert.deepEqual(findOneOpts.lock, {
      level: "UPDATE",
      of: models.RefreshToken,
    });
  } finally {
    models.RefreshToken.findOne = originalFindOne;
    sequelize.transaction = originalTransaction;
  }
});

test("Fase 7 - sessionService: rotateRefreshToken rejeita token expirado com 401 e remove do banco", async () => {
  let destroyedOpts = null;
  let txCommitted = false;
  const originalFindOne = models.RefreshToken.findOne;
  const originalTransaction = sequelize.transaction;
  const mockTx = { id: "tx-expired", LOCK: { UPDATE: "UPDATE" } };

  sequelize.transaction = async (callback) => {
    const res = await callback(mockTx);
    txCommitted = true;
    return res;
  };
  models.RefreshToken.findOne = async () => ({
    token: "token_expirado",
    expiresAt: new Date(Date.now() - 60000), // Expirou há 1 minuto
    destroy: async (opts) => {
      destroyedOpts = opts;
    },
  });

  try {
    await assert.rejects(
      async () => {
        await sessionService.rotateRefreshToken("token_expirado");
      },
      (err) => {
        return (
          err instanceof AppError &&
          err.statusCode === 401 &&
          err.message === "Refresh token inválido ou expirado."
        );
      }
    );
    assert.equal(destroyedOpts?.transaction, mockTx, "Token expirado deve ser destruído na transação");
    assert.equal(txCommitted, true, "Exclusão de token expirado deve ser confirmada (commit)");
  } finally {
    models.RefreshToken.findOne = originalFindOne;
    sequelize.transaction = originalTransaction;
  }
});

test("Fase 7 - sessionService: authenticate gera tokens e persiste hash SHA-256 do refreshToken", async () => {
  const originalFindByLogin = models.User.findByLogin;
  const originalCreate = models.RefreshToken.create;
  let storedRecord = null;

  const mockUser = {
    id: "user-uuid-1",
    username: "alice",
    email: "alice@unicap.br",
    validatePassword: async (pw) => pw === "password123",
  };
  models.User.findByLogin = async () => mockUser;
  models.RefreshToken.create = async (data) => {
    storedRecord = data;
    return data;
  };

  try {
    const result = await sessionService.authenticate("alice", "password123");
    assert.ok(result.accessToken);
    assert.equal(result.refreshToken.length, 80);
    assert.equal(result.user, mockUser);
    assert.ok(storedRecord);
    assert.notEqual(storedRecord.token, result.refreshToken);
    assert.equal(
      storedRecord.token,
      sessionService.hashRefreshToken(result.refreshToken)
    );
    assert.equal(storedRecord.userId, mockUser.id);
  } finally {
    models.User.findByLogin = originalFindByLogin;
    models.RefreshToken.create = originalCreate;
  }
});

test("Fase 7 - sessionService: rotateRefreshToken rotaciona token validado preservando expiresAt", async () => {
  const originalFindOne = models.RefreshToken.findOne;
  const originalFindByPk = models.User.findByPk;
  const originalDestroy = models.RefreshToken.destroy;
  const originalCreate = models.RefreshToken.create;
  const originalTransaction = sequelize.transaction;

  const futureDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const mockUser = {
    id: "user-uuid-2",
    username: "bob",
    email: "bob@unicap.br",
    role: "USER",
  };
  const lockedUser = {
    ...mockUser,
    role: "ADMIN",
  };
  const mockTx = { id: "tx-rotate-1", LOCK: { UPDATE: "UPDATE" } };
  let queriedHash = null;
  let findOneOpts = null;
  let findByPkArgs = null;
  let destroyedOptions = null;
  let createdRecord = null;
  let createdOptions = null;

  sequelize.transaction = async (callback) => await callback(mockTx);
  models.RefreshToken.findOne = async (opts) => {
    findOneOpts = opts;
    queriedHash = opts.where.token;
    return {
      id: "rt-uuid-1",
      expiresAt: futureDate,
      user: mockUser,
    };
  };
  models.User.findByPk = async (id, opts) => {
    findByPkArgs = { id, opts };
    return lockedUser;
  };
  models.RefreshToken.destroy = async (options) => {
    destroyedOptions = options;
    return 1;
  };
  models.RefreshToken.create = async (data, options) => {
    createdRecord = data;
    createdOptions = options;
    return data;
  };

  try {
    const oldToken = "a".repeat(80);
    const result = await sessionService.rotateRefreshToken(oldToken);

    assert.equal(queriedHash, sessionService.hashRefreshToken(oldToken));
    assert.equal(findOneOpts.transaction, mockTx);
    assert.deepEqual(findOneOpts.lock, {
      level: "UPDATE",
      of: models.RefreshToken,
    });
    assert.equal(findByPkArgs.id, mockUser.id);
    assert.deepEqual(findByPkArgs.opts, {
      transaction: mockTx,
      lock: "UPDATE",
    });
    assert.deepEqual(destroyedOptions.where, { id: "rt-uuid-1" });
    assert.equal(destroyedOptions.transaction, mockTx);
    assert.equal(createdOptions.transaction, mockTx);
    assert.ok(result.accessToken);
    assert.equal(result.refreshToken.length, 80);
    assert.notEqual(result.refreshToken, oldToken);
    assert.equal(result.user, lockedUser);
    assert.equal(createdRecord.expiresAt, futureDate);
    assert.equal(
      createdRecord.token,
      sessionService.hashRefreshToken(result.refreshToken)
    );
  } finally {
    models.RefreshToken.findOne = originalFindOne;
    models.User.findByPk = originalFindByPk;
    models.RefreshToken.destroy = originalDestroy;
    models.RefreshToken.create = originalCreate;
    sequelize.transaction = originalTransaction;
  }
});

test("Fase 7 - sessionService: rotateRefreshToken bloqueia corrida concorrente quando destroy retorna 0", async () => {
  const originalFindOne = models.RefreshToken.findOne;
  const originalFindByPk = models.User.findByPk;
  const originalDestroy = models.RefreshToken.destroy;
  const originalTransaction = sequelize.transaction;
  const mockTx = { id: "tx-rotate-race", LOCK: { UPDATE: "UPDATE" } };
  let destroyedTx = null;

  sequelize.transaction = async (callback) => await callback(mockTx);
  models.RefreshToken.findOne = async () => ({
    id: "rt-uuid-race",
    expiresAt: new Date(Date.now() + 60000),
    user: { id: "u-1", username: "bob", email: "bob@unicap.br" },
  });
  models.User.findByPk = async () => null;
  models.RefreshToken.destroy = async (options) => {
    destroyedTx = options.transaction;
    return 0;
  };

  try {
    await assert.rejects(
      async () => {
        await sessionService.rotateRefreshToken("b".repeat(80));
      },
      (err) => err instanceof AppError && err.statusCode === 401
    );
    assert.equal(destroyedTx, mockTx);
  } finally {
    models.RefreshToken.findOne = originalFindOne;
    models.User.findByPk = originalFindByPk;
    models.RefreshToken.destroy = originalDestroy;
    sequelize.transaction = originalTransaction;
  }
});

test("Fase 7 - sessionService: destroyRefreshToken remove usando hash SHA-256", async () => {
  const originalDestroy = models.RefreshToken.destroy;
  let destroyedWhere = null;
  models.RefreshToken.destroy = async ({ where }) => {
    destroyedWhere = where;
    return 1;
  };

  try {
    const rawToken = "c".repeat(80);
    await sessionService.destroyRefreshToken(rawToken);
    assert.deepEqual(destroyedWhere, {
      token: sessionService.hashRefreshToken(rawToken),
    });
  } finally {
    models.RefreshToken.destroy = originalDestroy;
  }
});
