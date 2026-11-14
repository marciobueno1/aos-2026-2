import { z } from "zod";

/**
 * Schema de criação de usuário.
 * Valida obrigatoriedade de username, email com formato válido e senha entre 7 e 42 caracteres.
 */
export const createUserSchema = z.object({
  body: z.object({
    username: z
      .string("Campo obrigatório")
      .trim()
      .min(1, "Campo obrigatório"),
    email: z
      .string({ error: "Campo obrigatório" })
      .trim()
      .min(1, "Campo obrigatório")
      .pipe(z.email("Formato de e-mail inválido")),
    password: z
      .string("Campo obrigatório")
      .min(7, "A senha deve ter entre 7 e 42 caracteres.")
      .max(42, "A senha deve ter entre 7 e 42 caracteres."),
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
      username: z
        .string()
        .trim()
        .min(1, "Campo não pode ser vazio")
        .optional(),
      email: z
        .string()
        .trim()
        .pipe(z.email("Formato de e-mail inválido"))
        .optional(),
      password: z
        .string()
        .min(7, "A senha deve ter entre 7 e 42 caracteres.")
        .max(42, "A senha deve ter entre 7 e 42 caracteres.")
        .optional(),
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
