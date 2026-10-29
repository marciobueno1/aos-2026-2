import test from "node:test";
import assert from "node:assert/strict";
import {
  createUserSchema,
  updateUserSchema,
  userIdParamSchema,
  createMessageSchema,
  updateMessageSchema,
  messageIdParamSchema,
} from "../src/middlewares/validationSchemas.js";

const VALID_UUID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

// -------------------------------------------------------------
// createUserSchema
// -------------------------------------------------------------
test("Fase 6 - createUserSchema: aceita username e email válidos e faz trim", () => {
  const result = createUserSchema.safeParse({
    body: {
      username: "  alice  ",
      email: "  alice@unicap.br  ",
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.data.body.username, "alice");
  assert.equal(result.data.body.email, "alice@unicap.br");
});

test("Fase 6 - createUserSchema: rejeita ausência de username", () => {
  const result = createUserSchema.safeParse({
    body: { email: "alice@unicap.br" },
  });
  assert.equal(result.success, false);
  assert.equal(
    result.error.issues.some((i) => i.path.includes("username")),
    true
  );
});

test("Fase 6 - createUserSchema: rejeita username vazio ou com apenas espaços", () => {
  const emptyRes = createUserSchema.safeParse({
    body: { username: "    ", email: "alice@unicap.br" },
  });
  assert.equal(emptyRes.success, false);
});

test("Fase 6 - createUserSchema: rejeita ausência ou formato inválido de email", () => {
  const noEmail = createUserSchema.safeParse({
    body: { username: "alice" },
  });
  assert.equal(noEmail.success, false);

  const invalidEmail = createUserSchema.safeParse({
    body: { username: "alice", email: "invalid-email-format" },
  });
  assert.equal(invalidEmail.success, false);
  assert.equal(
    invalidEmail.error.issues.some((i) =>
      i.message.includes("Formato de e-mail inválido")
    ),
    true
  );
});

// -------------------------------------------------------------
// updateUserSchema
// -------------------------------------------------------------
test("Fase 6 - updateUserSchema: permite atualizar apenas username", () => {
  const result = updateUserSchema.safeParse({
    body: { username: "novo_nome" },
  });
  assert.equal(result.success, true);
  assert.equal(result.data.body.username, "novo_nome");
  assert.equal(result.data.body.email, undefined);
});

test("Fase 6 - updateUserSchema: permite atualizar apenas email", () => {
  const result = updateUserSchema.safeParse({
    body: { email: "novo_email@unicap.br" },
  });
  assert.equal(result.success, true);
  assert.equal(result.data.body.email, "novo_email@unicap.br");
});

test("Fase 6 - updateUserSchema: permite atualizar ambos username e email", () => {
  const result = updateUserSchema.safeParse({
    body: { username: "novo_nome", email: "novo_email@unicap.br" },
  });
  assert.equal(result.success, true);
  assert.equal(result.data.body.username, "novo_nome");
  assert.equal(result.data.body.email, "novo_email@unicap.br");
});

test("Fase 6 - updateUserSchema: rejeita payload vazio com mensagem explicativa", () => {
  const result = updateUserSchema.safeParse({
    body: {},
  });
  assert.equal(result.success, false);
  assert.equal(
    result.error.issues.some((i) =>
      i.message.includes("Ao menos um campo (username ou email) deve ser fornecido")
    ),
    true
  );
});

test("Fase 6 - updateUserSchema: rejeita username vazio e email inválido", () => {
  const emptyUsername = updateUserSchema.safeParse({
    body: { username: "   " },
  });
  assert.equal(emptyUsername.success, false);

  const badEmail = updateUserSchema.safeParse({
    body: { email: "nao_eh_email" },
  });
  assert.equal(badEmail.success, false);
});

// -------------------------------------------------------------
// userIdParamSchema & messageIdParamSchema
// -------------------------------------------------------------
test("Fase 6 - userIdParamSchema: aceita UUID v4 válido", () => {
  const result = userIdParamSchema.safeParse({
    params: { userId: VALID_UUID },
  });
  assert.equal(result.success, true);
  assert.equal(result.data.params.userId, VALID_UUID);
});

test("Fase 6 - userIdParamSchema: rejeita strings que não sejam UUID", () => {
  const result = userIdParamSchema.safeParse({
    params: { userId: "id-invalido-123" },
  });
  assert.equal(result.success, false);
  assert.equal(
    result.error.issues.some((i) => i.message.includes("Formato de UUID inválido")),
    true
  );
});

test("Fase 6 - messageIdParamSchema: validação estrita de UUID", () => {
  const validRes = messageIdParamSchema.safeParse({
    params: { messageId: VALID_UUID },
  });
  assert.equal(validRes.success, true);

  const invalidRes = messageIdParamSchema.safeParse({
    params: { messageId: "12345" },
  });
  assert.equal(invalidRes.success, false);
  assert.equal(
    invalidRes.error.issues.some((i) => i.message.includes("Formato de UUID inválido")),
    true
  );
});

// -------------------------------------------------------------
// createMessageSchema & updateMessageSchema
// -------------------------------------------------------------
test("Fase 6 - createMessageSchema: aceita texto válido de mensagem", () => {
  const result = createMessageSchema.safeParse({
    body: { text: "  Olá mundo da disciplina AOS!  " },
  });
  assert.equal(result.success, true);
  assert.equal(result.data.body.text, "Olá mundo da disciplina AOS!");
});

test("Fase 6 - createMessageSchema: rejeita ausência de texto ou texto vazio", () => {
  const missingText = createMessageSchema.safeParse({ body: {} });
  assert.equal(missingText.success, false);

  const emptyText = createMessageSchema.safeParse({ body: { text: "    " } });
  assert.equal(emptyText.success, false);
});

test("Fase 6 - createMessageSchema: rejeita texto com mais de 1000 caracteres", () => {
  const tooLong = "a".repeat(1001);
  const result = createMessageSchema.safeParse({ body: { text: tooLong } });
  assert.equal(result.success, false);
  assert.equal(
    result.error.issues.some((i) =>
      i.message.includes("Texto deve ter no máximo 1000 caracteres")
    ),
    true
  );
});

test("Fase 6 - updateMessageSchema: validação uniforme com createMessageSchema", () => {
  const validRes = updateMessageSchema.safeParse({
    body: { text: "Mensagem atualizada" },
  });
  assert.equal(validRes.success, true);

  const emptyRes = updateMessageSchema.safeParse({ body: { text: "" } });
  assert.equal(emptyRes.success, false);
});
