import test from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";

import { envSchema, validateEnv } from "../src/utils/env.js";

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
