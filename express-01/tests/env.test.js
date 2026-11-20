import test from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";

import { envSchema, validateEnv, PUBLIC_SAMPLE_VALUES } from "../src/utils/env.js";

test("Fase 5 - envSchema: validação de ambiente com valores válidos", () => {
  const validData = {
    DATABASE_URL: "postgresql://user:pass@localhost:5432/testdb",
    PORT: "5000",
    NODE_ENV: "production",
    ALLOWED_ORIGINS: "http://localhost:3000",
    JWT_SECRET: "1234567890abcdef",
  };

  const result = envSchema.safeParse(validData);
  assert.equal(result.success, true);
  assert.equal(result.data.PORT, 5000);
  assert.equal(result.data.NODE_ENV, "production");
  assert.equal(result.data.ALLOWED_ORIGINS, "http://localhost:3000");
  assert.equal(result.data.JWT_SECRET, "1234567890abcdef");
});

test("Fase 5 - envSchema: valores padrão para PORT (4001) e NODE_ENV (development)", () => {
  const minimalData = {
    DATABASE_URL: "postgresql://user:pass@localhost:5432/testdb",
    ALLOWED_ORIGINS: "http://localhost:3000",
    JWT_SECRET: "1234567890abcdef",
  };

  const result = envSchema.safeParse(minimalData);
  assert.equal(result.success, true);
  assert.equal(result.data.PORT, 4001);
  assert.equal(result.data.NODE_ENV, "development");
});

test("Fase 5 - envSchema: rejeição quando DATABASE_URL está ausente ou malformatada", () => {
  const missingDb = envSchema.safeParse({
    ALLOWED_ORIGINS: "http://localhost:3000",
    JWT_SECRET: "1234567890abcdef",
  });
  assert.equal(missingDb.success, false);
  assert.equal(
    missingDb.error.issues.some((i) => i.path.includes("DATABASE_URL")),
    true
  );

  const invalidUrl = envSchema.safeParse({
    DATABASE_URL: "not-a-valid-url",
    ALLOWED_ORIGINS: "http://localhost:3000",
    JWT_SECRET: "1234567890abcdef",
  });
  assert.equal(invalidUrl.success, false);
  assert.equal(
    invalidUrl.error.issues.some((i) => i.path.includes("DATABASE_URL")),
    true
  );
});

test("Fase 5 - envSchema: rejeição quando ALLOWED_ORIGINS está vazio ou ausente", () => {
  const missingOrigins = envSchema.safeParse({
    DATABASE_URL: "postgresql://user:pass@localhost:5432/testdb",
    JWT_SECRET: "1234567890abcdef",
  });
  assert.equal(missingOrigins.success, false);
  assert.equal(
    missingOrigins.error.issues.some((i) => i.path.includes("ALLOWED_ORIGINS")),
    true
  );

  const emptyOrigins = envSchema.safeParse({
    DATABASE_URL: "postgresql://user:pass@localhost:5432/testdb",
    ALLOWED_ORIGINS: "",
    JWT_SECRET: "1234567890abcdef",
  });
  assert.equal(emptyOrigins.success, false);
});

test("Fase 5 - envSchema: rejeição de JWT_SECRET com menos de 10 caracteres", () => {
  const shortSecret = envSchema.safeParse({
    DATABASE_URL: "postgresql://user:pass@localhost:5432/testdb",
    ALLOWED_ORIGINS: "http://localhost:3000",
    JWT_SECRET: "curto",
  });
  assert.equal(shortSecret.success, false);
  assert.equal(
    shortSecret.error.issues.some(
      (i) => i.path.includes("JWT_SECRET") && i.message.includes("10 caracteres")
    ),
    true
  );
});

test("Fase 5 - validateEnv: fallback automático de MY_SECRET quando JWT_SECRET ausente", () => {
  const data = {
    DATABASE_URL: "postgresql://user:pass@localhost:5432/testdb",
    ALLOWED_ORIGINS: "http://localhost:3000",
    MY_SECRET: "legadosecretpassword",
  };

  const result = validateEnv(data);
  assert.equal(result.success, true);
  assert.equal(result.data.JWT_SECRET, "legadosecretpassword");
});

test("Fase 5 - validateEnv: preferência por JWT_SECRET sobre MY_SECRET quando ambos presentes", () => {
  const data = {
    DATABASE_URL: "postgresql://user:pass@localhost:5432/testdb",
    ALLOWED_ORIGINS: "http://localhost:3000",
    JWT_SECRET: "novosecretpassword",
    MY_SECRET: "legadosecretpassword",
  };

  const result = validateEnv(data);
  assert.equal(result.success, true);
  assert.equal(result.data.JWT_SECRET, "novosecretpassword");
});

test("Fase 5 - envSchema: SYNC_DATABASE e ERASE_DATABASE_ON_SYNC aceitam apenas 'true' ou 'false'", () => {
  const baseData = {
    DATABASE_URL: "postgresql://user:pass@localhost:5432/testdb",
    ALLOWED_ORIGINS: "http://localhost:3000",
    JWT_SECRET: "1234567890abcdef",
  };

  // Válidos
  assert.equal(
    envSchema.safeParse({ ...baseData, SYNC_DATABASE: "true", ERASE_DATABASE_ON_SYNC: "false" }).success,
    true
  );
  assert.equal(
    envSchema.safeParse({ ...baseData, SYNC_DATABASE: "false", ERASE_DATABASE_ON_SYNC: "true" }).success,
    true
  );

  // Inválidos
  const invalidSync = envSchema.safeParse({ ...baseData, SYNC_DATABASE: "sim" });
  assert.equal(invalidSync.success, false);
  assert.equal(
    invalidSync.error.issues.some((i) => i.path.includes("SYNC_DATABASE")),
    true
  );

  const invalidErase = envSchema.safeParse({ ...baseData, ERASE_DATABASE_ON_SYNC: "1" });
  assert.equal(invalidErase.success, false);
  assert.equal(
    invalidErase.error.issues.some((i) => i.path.includes("ERASE_DATABASE_ON_SYNC")),
    true
  );
});

test("Fase 10 - envSchema: ADMIN_PASSWORD e USER_PASSWORD opcionais respeitam intervalo de 7 a 42 caracteres", () => {
  const baseData = {
    DATABASE_URL: "postgresql://user:pass@localhost:5432/testdb",
    ALLOWED_ORIGINS: "http://localhost:3000",
    JWT_SECRET: "1234567890abcdef",
  };

  const omitted = envSchema.safeParse(baseData);
  assert.equal(omitted.success, true);
  assert.equal(omitted.data.ADMIN_PASSWORD, undefined);
  assert.equal(omitted.data.USER_PASSWORD, undefined);

  const validPasswords = envSchema.safeParse({
    ...baseData,
    ADMIN_PASSWORD: "a".repeat(7),
    USER_PASSWORD: "b".repeat(42),
  });
  assert.equal(validPasswords.success, true);

  const tooShortAdmin = envSchema.safeParse({
    ...baseData,
    ADMIN_PASSWORD: "short1",
  });
  assert.equal(tooShortAdmin.success, false);
  assert.equal(
    tooShortAdmin.error.issues.some(
      (i) =>
        i.path.includes("ADMIN_PASSWORD") &&
        i.message.includes("7 e 42 caracteres")
    ),
    true
  );

  const tooLongUser = envSchema.safeParse({
    ...baseData,
    USER_PASSWORD: "x".repeat(43),
  });
  assert.equal(tooLongUser.success, false);
  assert.equal(
    tooLongUser.error.issues.some(
      (i) =>
        i.path.includes("USER_PASSWORD") &&
        i.message.includes("7 e 42 caracteres")
    ),
    true
  );
});

test("Fase 10 - envSchema: bloqueia ERASE_DATABASE_ON_SYNC='true' quando NODE_ENV='production'", () => {
  const baseData = {
    DATABASE_URL: "postgresql://user:pass@localhost:5432/testdb",
    ALLOWED_ORIGINS: "https://app.example.com",
    JWT_SECRET: "1234567890abcdef",
  };

  const blocked = envSchema.safeParse({
    ...baseData,
    NODE_ENV: "production",
    ERASE_DATABASE_ON_SYNC: "true",
  });
  assert.equal(blocked.success, false);
  assert.equal(
    blocked.error.issues.some(
      (i) =>
        i.path.includes("ERASE_DATABASE_ON_SYNC") &&
        i.message.includes("não pode ser 'true' em ambiente de produção")
    ),
    true
  );

  const allowedProdFalse = envSchema.safeParse({
    ...baseData,
    NODE_ENV: "production",
    ERASE_DATABASE_ON_SYNC: "false",
  });
  assert.equal(allowedProdFalse.success, true);

  const allowedDevTrue = envSchema.safeParse({
    ...baseData,
    NODE_ENV: "development",
    ERASE_DATABASE_ON_SYNC: "true",
  });
  assert.equal(allowedDevTrue.success, true);
});

test("Passo 11 - envSchema: rejeita em produção segredos iguais a valores públicos de exemplo", () => {
  const baseData = {
    DATABASE_URL: "postgresql://user:pass@localhost:5432/testdb",
    ALLOWED_ORIGINS: "https://app.example.com",
    NODE_ENV: "production",
  };

  for (const sample of PUBLIC_SAMPLE_VALUES) {
    const jwtSample = envSchema.safeParse({ ...baseData, JWT_SECRET: sample });
    if (sample.length >= 10) {
      assert.equal(jwtSample.success, false, `JWT_SECRET=${sample} deveria ser rejeitado`);
      assert.ok(jwtSample.error.issues.some((i) => i.path.includes("JWT_SECRET") && i.message.includes("valor público")));
    }

    const adminSample = envSchema.safeParse({
      ...baseData,
      JWT_SECRET: "segredo-proprio-com-mais-de-10",
      ADMIN_PASSWORD: sample,
    });
    if (sample.length >= 7 && sample.length <= 42) {
      assert.equal(adminSample.success, false, `ADMIN_PASSWORD=${sample} deveria ser rejeitado`);
    }
  }

  const devWithSample = envSchema.safeParse({
    ...baseData,
    NODE_ENV: "development",
    JWT_SECRET: "mysupersecretpassword",
  });
  assert.equal(devWithSample.success, true);

  const prodOk = envSchema.safeParse({ ...baseData, JWT_SECRET: "segredo-proprio-com-mais-de-10" });
  assert.equal(prodOk.success, true);
});
