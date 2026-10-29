import test from "node:test";
import assert from "node:assert/strict";
import { z, ZodError } from "zod";
import validate from "../src/middlewares/validate.js";

test("Fase 6 - validate: requisição válida atualiza req.body e chama next()", async () => {
  const schema = z.object({
    body: z.object({
      name: z.string().trim(),
    }),
  });

  const middleware = validate(schema);
  const req = {
    body: { name: "  alice  ", extra: "discarded" },
    params: {},
    query: {},
  };
  const res = {};
  let nextCalled = false;
  let nextArg = null;

  await middleware(req, res, (err) => {
    nextCalled = true;
    nextArg = err;
  });

  assert.equal(nextCalled, true);
  assert.equal(nextArg, undefined);
  assert.equal(req.body.name, "alice");
  assert.equal(req.body.extra, undefined, "Campos extras não mapeados devem ser sanitizados pelo schema");
});

test("Fase 6 - validate: requisição válida atualiza req.params e preserva req.body", async () => {
  const schema = z.object({
    params: z.object({
      id: z.string().uuid(),
    }),
  });

  const middleware = validate(schema);
  const req = {
    body: { somePayload: "preserved" },
    params: { id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" },
    query: {},
  };
  const res = {};
  let nextCalled = false;

  await middleware(req, res, (err) => {
    nextCalled = true;
    assert.equal(err, undefined);
  });

  assert.equal(nextCalled, true);
  assert.equal(req.params.id, "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11");
  assert.equal(req.body.somePayload, "preserved", "req.body original deve ser preservado quando schema valida apenas params");
});

test("Fase 6 - validate: falha de validação encaminha ZodError para next(err)", async () => {
  const schema = z.object({
    body: z.object({
      age: z.number(),
    }),
  });

  const middleware = validate(schema);
  const req = {
    body: { age: "not-a-number" },
    params: {},
    query: {},
  };
  const res = {};
  let nextArg = null;

  await middleware(req, res, (err) => {
    nextArg = err;
  });

  assert.ok(nextArg instanceof ZodError);
  assert.equal(nextArg.name, "ZodError");
  assert.equal(nextArg.issues[0].path.join("."), "body.age");
});
