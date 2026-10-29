import { z } from "zod";

/**
 * Schema de validação das variáveis de ambiente no startup da aplicação.
 * Garante o princípio fail-fast: qualquer variável obrigatória faltante
 * ou malformatada interrompe a execução imediatamente com process.exit(1).
 */
export const envSchema = z.object({
  DATABASE_URL: z.url({
    error: (issue) =>
      issue.code === "invalid_type"
        ? "DATABASE_URL é obrigatória."
        : "DATABASE_URL deve ser uma URL válida.",
  }),
  PORT: z.coerce.number().default(4001),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  ALLOWED_ORIGINS: z
    .string("ALLOWED_ORIGINS é obrigatório.")
    .min(1, "ALLOWED_ORIGINS é obrigatório."),
  JWT_SECRET: z
    .string("JWT_SECRET ou MY_SECRET é obrigatório.")
    .min(10, "JWT_SECRET deve ter no mínimo 10 caracteres."),
  SYNC_DATABASE: z
    .enum(["true", "false"], {
      error: "SYNC_DATABASE deve ser 'true' ou 'false'.",
    })
    .optional(),
  ERASE_DATABASE_ON_SYNC: z
    .enum(["true", "false"], {
      error: "ERASE_DATABASE_ON_SYNC deve ser 'true' ou 'false'.",
    })
    .optional(),
});

/**
 * Valida um objeto de variáveis de ambiente com suporte a fallback de JWT_SECRET -> MY_SECRET.
 *
 * @param {Record<string, string | undefined>} data
 * @returns {import("zod").SafeParseReturnType<any, any>}
 */
export const validateEnv = (data = process.env) => {
  const rawEnv = {
    ...data,
    JWT_SECRET: data.JWT_SECRET || data.MY_SECRET,
  };
  return envSchema.safeParse(rawEnv);
};

// Execução Fail-Fast na importação do módulo (ativa por padrão; ignorada em suite de testes isolados)
const isTestEnv = process.env.NODE_ENV === "test";
const result = validateEnv(process.env);

if (!result.success && !isTestEnv) {
  console.error("❌ Falha na validação das variáveis de ambiente:");
  const formattedErrors = (result.error.issues || result.error.errors || []).map(
    (issue) => `  - ${issue.path.join(".")}: ${issue.message}`
  );
  console.error(formattedErrors.join("\n"));
  process.exit(1);
}

export const env = result.success ? result.data : process.env;
export default env;
