import test from "node:test";
import assert from "node:assert/strict";
import AppError from "../src/utils/appError.js";
import notFoundMiddleware from "../src/middlewares/notFound.js";
import corsMiddleware from "../src/middlewares/cors.js";
import { limiterMiddleware, authLimiterMiddleware } from "../src/middlewares/rateLimiter.js";

test("Sem Regressões - AppError: instancia com propriedades operacionais corretas", () => {
  const err400 = new AppError("Bad request", 400);
  assert.equal(err400.statusCode, 400);
  assert.equal(err400.status, "fail");
  assert.equal(err400.isOperational, true);

  const err500 = new AppError("Internal error", 500);
  assert.equal(err500.statusCode, 500);
  assert.equal(err500.status, "error");
  assert.equal(err500.isOperational, true);
});

test("Sem Regressões - notFoundMiddleware: repassa AppError 404 para next", () => {
  const req = { originalUrl: "/rota-inexistente" };
  const res = {};
  let capturedError = null;

  notFoundMiddleware(req, res, (err) => {
    capturedError = err;
  });

  assert.ok(capturedError instanceof AppError);
  assert.equal(capturedError.statusCode, 404);
  assert.equal(capturedError.status, "fail");
  assert.ok(capturedError.message.includes("/rota-inexistente"));
});

test("Sem Regressões - corsMiddleware: aceita requisições sem origin (mobile/curl)", (t, done) => {
  const req = {
    headers: {},
    method: "GET",
    url: "/users",
  };
  const res = {
    setHeader() {},
    getHeader() {},
  };

  corsMiddleware(req, res, (err) => {
    assert.equal(err, undefined);
    done();
  });
});

test("Sem Regressões - corsMiddleware: rejeita com AppError 403 origem não autorizada", (t, done) => {
  const req = {
    headers: { origin: "https://evil-site.com" },
    method: "GET",
    url: "/users",
    ip: "127.0.0.1",
  };
  const res = {
    setHeader() {},
    getHeader() {},
  };

  corsMiddleware(req, res, (err) => {
    assert.ok(err instanceof AppError);
    assert.equal(err.statusCode, 403);
    assert.ok(err.message.includes("https://evil-site.com"));
    done();
  });
});

test("Sem Regressões - rateLimiter: middlewares exportados são funções válidas do Express", () => {
  assert.equal(typeof limiterMiddleware, "function");
  assert.equal(typeof authLimiterMiddleware, "function");
});
