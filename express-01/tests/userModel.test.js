import test from "node:test";
import assert from "node:assert/strict";
import argon2 from "argon2";
import Sequelize from "sequelize";
import pg from "pg";

import getUserModel from "../src/models/user.js";

// Inicializa Sequelize dummy em memória/postgres para teste isolado do modelo User
const dummySequelize = new Sequelize("postgres://dummy:dummy@localhost:5432/dummy_db", {
  dialect: "postgres",
  dialectModule: pg,
  logging: false,
});
// Para poder instanciar modelos sem conectar ao banco real
const User = getUserModel(dummySequelize, Sequelize);

test("Fase 7 - Modelo User: toJSON omite campo password para prevenir vazamento (CWE-200)", () => {
  const instance = User.build({
    id: "123e4567-e89b-12d3-a456-426614174000",
    username: "alice",
    email: "alice@unicap.br",
    password: "$argon2id$v=19$m=65536,t=3,p=4$dummyhash",
  });

  const jsonObject = instance.toJSON();
  assert.equal(jsonObject.username, "alice");
  assert.equal(jsonObject.email, "alice@unicap.br");
  assert.equal(jsonObject.password, undefined);

  const serialized = JSON.stringify(instance);
  assert.equal(serialized.includes("dummyhash"), false);
});

test("Fase 7 - Modelo User: generatePasswordHash e validatePassword funcionam com Argon2", async () => {
  const instance = User.build({
    id: "123e4567-e89b-12d3-a456-426614174000",
    username: "bob",
    email: "bob@unicap.br",
    password: "mypassword123",
  });

  const hash = await instance.generatePasswordHash();
  assert.ok(hash.startsWith("$argon2id$"));

  instance.password = hash;
  const isCorrect = await instance.validatePassword("mypassword123");
  assert.equal(isCorrect, true);

  const isWrong = await instance.validatePassword("wrongpassword");
  assert.equal(isWrong, false);
});

test("Fase 7 - Modelo User: validador aceita senha plain text válida e hash $argon2 sem estourar limite", async () => {
  // Senha texto puro válida (13 chars)
  const validUser = User.build({
    username: "clara",
    email: "clara@unicap.br",
    password: "validpassword",
  });
  await assert.doesNotReject(async () => {
    await validUser.validate();
  });

  // Senha com hash Argon2 (97+ chars) - não deve falhar no validador
  const hashedUser = User.build({
    username: "clara",
    email: "clara@unicap.br",
    password: await argon2.hash("validpassword"),
  });
  await assert.doesNotReject(async () => {
    await hashedUser.validate();
  });

  // Senha texto puro muito curta (< 7 chars)
  const shortUser = User.build({
    username: "clara",
    email: "clara@unicap.br",
    password: "123",
  });
  await assert.rejects(
    async () => {
      await shortUser.validate();
    },
    (err) => {
      return (
        err.name === "SequelizeValidationError" &&
        err.errors?.some((e) =>
          e.message.includes("A senha deve ter entre 7 e 42 caracteres.")
        )
      );
    }
  );
});

test("Fase 7 - Modelo User: senha falsa começando com '$argon2' NÃO burla hash nem validação", async () => {
  // String longa começando com '$argon2' que não é hash PHC válido deve ser rejeitada pelo limite de 42 chars
  const fakeLongHashUser = User.build({
    username: "clara",
    email: "clara@unicap.br",
    password: "$argon2fake_string_que_excede_quarenta_e_dois_caracteres",
  });
  await assert.rejects(
    async () => {
      await fakeLongHashUser.validate();
    },
    (err) => err.name === "SequelizeValidationError"
  );

  // String curta (11 chars) começando com '$argon2' deve ser hasheada pelo beforeCreate
  const fakeShortUser = User.build({
    username: "clara",
    email: "clara@unicap.br",
    password: "$argon2fake",
  });
  await User.runHooks("beforeCreate", fakeShortUser);
  assert.notEqual(fakeShortUser.password, "$argon2fake");
  assert.ok(fakeShortUser.password.startsWith("$argon2id$v="));
  assert.equal(await fakeShortUser.validatePassword("$argon2fake"), true);
});

test("Fase 8 - Modelo User: define role padrão 'USER', aceita 'ADMIN' e preserva role em toJSON()", () => {
  const defaultUser = User.build({
    id: "123e4567-e89b-12d3-a456-426614174000",
    username: "comum",
    email: "comum@unicap.br",
    password: "password123",
  });
  assert.equal(defaultUser.role, "USER");
  assert.equal(defaultUser.toJSON().role, "USER");
  assert.equal(defaultUser.toJSON().password, undefined);

  const adminUser = User.build({
    id: "123e4567-e89b-12d3-a456-426614174001",
    username: "admin",
    email: "admin@unicap.br",
    password: "password123",
    role: "ADMIN",
  });
  assert.equal(adminUser.role, "ADMIN");
  assert.equal(adminUser.toJSON().role, "ADMIN");
  assert.equal(adminUser.toJSON().password, undefined);
});
