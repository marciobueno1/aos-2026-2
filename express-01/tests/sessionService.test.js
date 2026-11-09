import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecretpassword123";

import sessionService from "../src/services/sessionService.js";
import models from "../src/models/index.js";
import { AppError } from "../src/utils/index.js";

test("Fase 7 - sessionService: createAccessToken gera JWT válido com claims do usuário", () => {
  const user = {
    id: "user-123",
    username: "alice",
    email: "alice@unicap.br",
  };

  const token = sessionService.createAccessToken(user);
  assert.ok(typeof token === "string" && token.length > 20);

  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  assert.equal(decoded.id, user.id);
  assert.equal(decoded.username, user.username);
  assert.equal(decoded.email, user.email);
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
  models.RefreshToken.findOne = async () => null;

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
  } finally {
    models.RefreshToken.findOne = originalFindOne;
  }
});

test("Fase 7 - sessionService: rotateRefreshToken rejeita token expirado com 401 e remove do banco", async () => {
  let destroyed = false;
  const originalFindOne = models.RefreshToken.findOne;
  models.RefreshToken.findOne = async () => ({
    token: "token_expirado",
    expiresAt: new Date(Date.now() - 60000), // Expirou há 1 minuto
    destroy: async () => {
      destroyed = true;
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
    assert.equal(destroyed, true, "Token expirado deve ser destruído no banco");
  } finally {
    models.RefreshToken.findOne = originalFindOne;
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
  const originalDestroy = models.RefreshToken.destroy;
  const originalCreate = models.RefreshToken.create;

  const futureDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const mockUser = {
    id: "user-uuid-2",
    username: "bob",
    email: "bob@unicap.br",
  };
  let queriedHash = null;
  let destroyedWhere = null;
  let createdRecord = null;

  models.RefreshToken.findOne = async ({ where }) => {
    queriedHash = where.token;
    return {
      id: "rt-uuid-1",
      expiresAt: futureDate,
      user: mockUser,
    };
  };
  models.RefreshToken.destroy = async ({ where }) => {
    destroyedWhere = where;
    return 1;
  };
  models.RefreshToken.create = async (data) => {
    createdRecord = data;
    return data;
  };

  try {
    const oldToken = "a".repeat(80);
    const result = await sessionService.rotateRefreshToken(oldToken);

    assert.equal(queriedHash, sessionService.hashRefreshToken(oldToken));
    assert.deepEqual(destroyedWhere, { id: "rt-uuid-1" });
    assert.ok(result.accessToken);
    assert.equal(result.refreshToken.length, 80);
    assert.notEqual(result.refreshToken, oldToken);
    assert.equal(result.user, mockUser);
    assert.equal(createdRecord.expiresAt, futureDate);
    assert.equal(
      createdRecord.token,
      sessionService.hashRefreshToken(result.refreshToken)
    );
  } finally {
    models.RefreshToken.findOne = originalFindOne;
    models.RefreshToken.destroy = originalDestroy;
    models.RefreshToken.create = originalCreate;
  }
});

test("Fase 7 - sessionService: rotateRefreshToken bloqueia corrida concorrente quando destroy retorna 0", async () => {
  const originalFindOne = models.RefreshToken.findOne;
  const originalDestroy = models.RefreshToken.destroy;

  models.RefreshToken.findOne = async () => ({
    id: "rt-uuid-race",
    expiresAt: new Date(Date.now() + 60000),
    user: { id: "u-1", username: "bob", email: "bob@unicap.br" },
  });
  models.RefreshToken.destroy = async () => 0;

  try {
    await assert.rejects(
      async () => {
        await sessionService.rotateRefreshToken("b".repeat(80));
      },
      (err) => err instanceof AppError && err.statusCode === 401
    );
  } finally {
    models.RefreshToken.findOne = originalFindOne;
    models.RefreshToken.destroy = originalDestroy;
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
