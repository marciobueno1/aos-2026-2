import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecretpassword123";
process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgres://dummy:dummy@localhost:5432/dummy_db";

import { authMiddleware, protectRoutes } from "../src/middlewares/auth.js";
import { AppError, env } from "../src/utils/index.js";
import { userService } from "../src/services/index.js";

// -------------------------------------------------------------
// authMiddleware
// -------------------------------------------------------------
test("Fase 7 - authMiddleware: requisição sem header Authorization define req.context.me = null e chama next()", async () => {
  const req = { headers: {} };
  let nextCalled = false;
  let nextError = null;

  await authMiddleware(req, {}, (err) => {
    nextCalled = true;
    nextError = err;
  });

  assert.equal(nextCalled, true);
  assert.equal(nextError, undefined);
  assert.equal(req.context.me, null);
});

test("Fase 7 - authMiddleware: header sem prefixo Bearer define req.context.me = null e chama next()", async () => {
  const req = { headers: { authorization: "Basic dXNlcjpwYXNz" } };
  let nextCalled = false;

  await authMiddleware(req, {}, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(req.context.me, null);
});

test("Fase 7 - authMiddleware: token malformado ou inválido repassa AppError 401 para next", async () => {
  const req = { headers: { authorization: "Bearer token-completamente-invalido" } };
  let capturedError = null;

  await authMiddleware(req, {}, (err) => {
    capturedError = err;
  });

  assert.ok(capturedError instanceof AppError);
  assert.equal(capturedError.statusCode, 401);
  assert.equal(capturedError.message, "Token inválido ou expirado.");
});

test("Fase 7 - authMiddleware: token expirado repassa AppError 401 para next", async () => {
  const jwtSecret = env.JWT_SECRET || process.env.JWT_SECRET;
  // Token gerado já expirado (-10s)
  const expiredToken = jwt.sign(
    { id: "123e4567-e89b-12d3-a456-426614174000" },
    jwtSecret,
    { expiresIn: "-10s" }
  );

  const req = { headers: { authorization: `Bearer ${expiredToken}` } };
  let capturedError = null;

  await authMiddleware(req, {}, (err) => {
    capturedError = err;
  });

  assert.ok(capturedError instanceof AppError);
  assert.equal(capturedError.statusCode, 401);
  assert.equal(capturedError.message, "Token inválido ou expirado.");
});

test("Fase 7 - authMiddleware: token válido busca usuário e injeta em req.context.me", async () => {
  const jwtSecret = env.JWT_SECRET || process.env.JWT_SECRET;
  const mockUser = { id: "user-uuid-123", username: "rwieruch" };
  const originalGetUserById = userService.getUserById;
  userService.getUserById = async (id) => (id === mockUser.id ? mockUser : null);

  try {
    const validToken = jwt.sign(
      { id: mockUser.id, username: mockUser.username },
      jwtSecret,
      { expiresIn: "15m" }
    );

    const req = { headers: { authorization: `Bearer ${validToken}` } };
    let nextCalled = false;
    let nextError = null;

    await authMiddleware(req, {}, (err) => {
      nextCalled = true;
      nextError = err;
    });

    assert.equal(nextCalled, true);
    assert.equal(nextError, undefined);
    assert.deepEqual(req.context.me, mockUser);
  } finally {
    userService.getUserById = originalGetUserById;
  }
});

test("Fase 7 - authMiddleware: token expirado em rota pública não bloqueia e define req.context.me = null", async () => {
  const jwtSecret = env.JWT_SECRET || process.env.JWT_SECRET;
  const expiredToken = jwt.sign(
    { id: "123e4567-e89b-12d3-a456-426614174000" },
    jwtSecret,
    { expiresIn: "-10s" }
  );

  const req = {
    method: "POST",
    path: "/session/refresh",
    baseUrl: "",
    headers: { authorization: `Bearer ${expiredToken}` },
  };
  let nextCalled = false;
  let capturedError = null;

  await authMiddleware(req, {}, (err) => {
    nextCalled = true;
    capturedError = err;
  });

  assert.equal(nextCalled, true);
  assert.equal(capturedError, undefined);
  assert.equal(req.context.me, null);
});

test("Fase 7 - authMiddleware: erro de banco em getUserById propaga o erro original (não mascara como 401)", async () => {
  const jwtSecret = env.JWT_SECRET || process.env.JWT_SECRET;
  const originalGetUserById = userService.getUserById;
  const dbError = new Error("Connection terminated unexpectedly");
  userService.getUserById = async () => {
    throw dbError;
  };

  try {
    const validToken = jwt.sign(
      { id: "user-uuid-123", username: "rwieruch" },
      jwtSecret,
      { expiresIn: "15m" }
    );
    const req = { headers: { authorization: `Bearer ${validToken}` } };
    let capturedError = null;

    await authMiddleware(req, {}, (err) => {
      capturedError = err;
    });

    assert.equal(capturedError, dbError);
  } finally {
    userService.getUserById = originalGetUserById;
  }
});

// -------------------------------------------------------------
// protectRoutes
// -------------------------------------------------------------
test("Fase 7 - protectRoutes: libera requisições OPTIONS (CORS preflight)", () => {
  const req = { method: "OPTIONS", path: "/users", context: {} };
  let nextCalled = false;

  protectRoutes(req, {}, (err) => {
    assert.equal(err, undefined);
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
});

test("Fase 7 - protectRoutes: libera rotas públicas sem autenticação", () => {
  const publicCalls = [
    { method: "GET", path: "/" },
    { method: "HEAD", path: "/" },
    { method: "POST", path: "/session" },
    { method: "POST", path: "/session/refresh" },
    { method: "DELETE", path: "/session" },
    { method: "POST", path: "/users" },
  ];

  for (const { method, path } of publicCalls) {
    const req = { method, path, baseUrl: "", context: { me: null } };
    let nextCalled = false;

    protectRoutes(req, {}, (err) => {
      assert.equal(err, undefined);
      nextCalled = true;
    });

    assert.equal(nextCalled, true, `Rota ${method} ${path} deveria ser pública`);
  }
});

test("Fase 7 - protectRoutes: bloqueia rotas privadas sem autenticação com AppError 401", () => {
  const privateCalls = [
    { method: "GET", path: "/session" },
    { method: "GET", path: "/users" },
    { method: "GET", path: "/messages" },
    { method: "POST", path: "/messages" },
    { method: "PUT", path: "/messages/123" },
    { method: "DELETE", path: "/messages/123" },
    { method: "PUT", path: "/users/123" },
    { method: "DELETE", path: "/users/123" },
  ];

  for (const { method, path } of privateCalls) {
    const req = { method, path, baseUrl: "", context: { me: null } };
    let capturedErr = null;

    protectRoutes(req, {}, (err) => {
      capturedErr = err;
    });

    assert.ok(capturedErr instanceof AppError, `Rota ${method} ${path} deveria lançar AppError`);
    assert.equal(capturedErr.statusCode, 401);
    assert.equal(capturedErr.message, "Acesso não autorizado. Autenticação obrigatória.");
  }
});

test("Fase 7 - protectRoutes: libera rotas privadas quando req.context.me está autenticado", () => {
  const req = {
    method: "GET",
    path: "/session",
    baseUrl: "",
    context: { me: { id: "123", username: "rwieruch" } },
  };

  let nextCalled = false;
  protectRoutes(req, {}, (err) => {
    assert.equal(err, undefined);
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
});
