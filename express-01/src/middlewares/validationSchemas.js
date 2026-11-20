import { z } from "zod";

const usernameSchema = ({ required = true } = {}) => {
  const base = (required ? z.string("Campo obrigatório") : z.string())
    .trim()
    .min(1, required ? "Campo obrigatório" : "Campo não pode ser vazio")
    .max(255, "Username deve ter no máximo 255 caracteres")
    .refine((val) => !val.includes("@"), {
      message: "Username não pode conter o caractere '@'.",
    });

  return required ? base : base.optional();
};

const emailSchema = ({ required = true } = {}) => {
  const trimmed = (
    required ? z.string({ error: "Campo obrigatório" }) : z.string()
  )
    .trim()
    .toLowerCase();

  const sized = required ? trimmed.min(1, "Campo obrigatório") : trimmed;
  const validated = sized
    .max(255, "E-mail deve ter no máximo 255 caracteres")
    .pipe(z.email("Formato de e-mail inválido"));

  return required ? validated : validated.optional();
};

const passwordSchema = ({ required = true } = {}) => {
  const base = (required ? z.string("Campo obrigatório") : z.string())
    .min(7, "A senha deve ter entre 7 e 42 caracteres.")
    .max(42, "A senha deve ter entre 7 e 42 caracteres.");

  return required ? base : base.optional();
};

/**
 * Schema de criação de usuário.
 * Valida obrigatoriedade de username, email com formato válido e senha entre 7 e 42 caracteres.
 */
export const createUserSchema = z.object({
  body: z.object({
    username: usernameSchema({ required: true }),
    email: emailSchema({ required: true }),
    password: passwordSchema({ required: true }),
  }),
});

/**
 * Schema de atualização de usuário.
 * Permite atualização parcial de username, email, password e/ou role (restrito a ADMIN no controller),
 * exigindo que ao menos um campo seja enviado.
 */
export const updateUserSchema = z.object({
  body: z
    .object({
      username: usernameSchema({ required: false }),
      email: emailSchema({ required: false }),
      password: passwordSchema({ required: false }),
      role: z
        .enum(["USER", "ADMIN"], {
          error: "Perfil de acesso inválido. Valores permitidos: USER, ADMIN.",
        })
        .optional(),
    })
    .refine(
      (data) =>
        data.username !== undefined ||
        data.email !== undefined ||
        data.password !== undefined ||
        data.role !== undefined,
      {
        message:
          "Ao menos um campo (username, email, password ou role) deve ser fornecido para atualização.",
      }
    ),
});

/**
 * Schema de validação do parâmetro :userId.
 * Exige formato UUID v4 válido.
 */
export const userIdParamSchema = z.object({
  params: z.object({
    userId: z.uuid("Formato de UUID inválido"),
  }),
});

/**
 * Schema de criação de mensagem.
 * Exige texto não vazio com no máximo 1000 caracteres.
 */
export const createMessageSchema = z.object({
  body: z.object({
    text: z
      .string("Campo obrigatório")
      .trim()
      .min(1, "Campo obrigatório")
      .max(1000, "Texto deve ter no máximo 1000 caracteres"),
  }),
});

/**
 * Schema de atualização de mensagem.
 * Exige texto não vazio com no máximo 1000 caracteres.
 */
export const updateMessageSchema = z.object({
  body: z.object({
    text: z
      .string("Campo obrigatório")
      .trim()
      .min(1, "Campo obrigatório")
      .max(1000, "Texto deve ter no máximo 1000 caracteres"),
  }),
});

/**
 * Schema de validação do parâmetro :messageId.
 * Exige formato UUID v4 válido.
 */
export const messageIdParamSchema = z.object({
  params: z.object({
    messageId: z.uuid("Formato de UUID inválido"),
  }),
});

/**
 * Schema de login/autenticação.
 * Exige credenciais de login (username ou email) e senha.
 */
export const loginSchema = z.object({
  body: z.object({
    login: z
      .string("Campo obrigatório")
      .trim()
      .min(1, "Campo obrigatório"),
    password: z
      .string("Campo obrigatório")
      .min(1, "Campo obrigatório"),
  }),
});

/**
 * Schema de refresh token e logout.
 * Exige a string do refresh token no body.
 */
export const refreshTokenSchema = z.object({
  body: z.object({
    refreshToken: z
      .string("Campo obrigatório")
      .trim()
      .min(1, "Campo obrigatório"),
  }),
});

/**
 * Schema de paginação e ordenação para endpoints de listagem.
 * Valida page (1..1000000), limit (1..100) e order (ASC/DESC, case-insensitive).
 */
export const paginationQuerySchema = z.object({
  query: z.object({
    page: z.coerce
      .number("Parâmetro page deve ser numérico.")
      .int("Parâmetro page deve ser um número inteiro.")
      .min(1, "Parâmetro page deve ser no mínimo 1.")
      .max(1000000, "Parâmetro page deve ser no máximo 1000000.")
      .default(1),
    limit: z.coerce
      .number("Parâmetro limit deve ser numérico.")
      .int("Parâmetro limit deve ser um número inteiro.")
      .min(1, "Parâmetro limit deve estar entre 1 e 100.")
      .max(100, "Parâmetro limit deve estar entre 1 e 100.")
      .default(10),
    order: z
      .enum(["ASC", "DESC", "asc", "desc"], {
        error: "Parâmetro order deve ser 'ASC' ou 'DESC'.",
      })
      .transform((val) => val.toUpperCase())
      .default("DESC"),
  }),
});
