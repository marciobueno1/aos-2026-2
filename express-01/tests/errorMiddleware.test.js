import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import errorMiddleware from "../src/middlewares/error.js";
import AppError from "../src/utils/appError.js";

// Helper para mock de response do Express
const createMockResponse = () => {
  const res = {
    statusCode: null,
    body: null,
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

test("Fase 6 - errorMiddleware: formata ZodError com status 400, message concatenada e array errors", () => {
  const dummySchema = z.object({
    username: z.string().min(1, "Campo obrigatório"),
    email: z.string().email("Formato de e-mail inválido"),
  });

  const parseResult = dummySchema.safeParse({ username: "", email: "invalido" });
  assert.equal(parseResult.success, false);

  const res = createMockResponse();
  const req = {};
  const next = () => {};

  errorMiddleware(parseResult.error, req, res, next);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.status, "fail");
  assert.ok(Array.isArray(res.body.errors));
  assert.equal(res.body.errors.length, 2);
  assert.ok(res.body.message.includes("; "));
  assert.ok(res.body.errors.some((e) => e.includes("username:")));
  assert.ok(res.body.errors.some((e) => e.includes("email:")));
});

test("Sem Regressões - errorMiddleware: formata AppError com status operacional customizado", () => {
  const appError = new AppError("Recurso não encontrado", 404);
  const res = createMockResponse();

  errorMiddleware(appError, {}, res, () => {});

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.status, "fail");
  assert.equal(res.body.message, "Recurso não encontrado");
});

test("Sem Regressões - errorMiddleware: formata SequelizeUniqueConstraintError como 409 Conflict", () => {
  const uniqueError = new Error("Unique constraint error");
  uniqueError.name = "SequelizeUniqueConstraintError";
  uniqueError.errors = [{ message: "username deve ser único" }];

  const res = createMockResponse();
  errorMiddleware(uniqueError, {}, res, () => {});

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.status, "fail");
  assert.equal(res.body.message, "username deve ser único");
});

test("Sem Regressões - errorMiddleware: formata SequelizeValidationError como 400 Bad Request", () => {
  const valError = new Error("Validation error");
  valError.name = "SequelizeValidationError";
  valError.errors = [{ message: "Validation notEmpty on text failed" }];

  const res = createMockResponse();
  errorMiddleware(valError, {}, res, () => {});

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.status, "fail");
  assert.equal(res.body.message, "Validation notEmpty on text failed");
});

test("Sem Regressões - errorMiddleware: formata erro 22P02 do PostgreSQL como 400 Bad Request", () => {
  const dbError = new Error("invalid input syntax for type uuid");
  dbError.name = "SequelizeDatabaseError";
  dbError.original = { code: "22P02" };

  const res = createMockResponse();
  errorMiddleware(dbError, {}, res, () => {});

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.status, "fail");
  assert.equal(res.body.message, "Identificador (ID) fornecido possui formato inválido.");
});

test("Sem Regressões - errorMiddleware: formata erro inesperado como 500 Internal Server Error", () => {
  const genericError = new Error("Falha imprevista no banco de dados");
  const res = createMockResponse();

  errorMiddleware(genericError, {}, res, () => {});

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.status, "error");
});
