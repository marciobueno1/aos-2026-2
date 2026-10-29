import { z } from "zod";

/**
 * Schema de criação de usuário.
 * Valida obrigatoriedade de username e email com formato válido.
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
  }),
});

/**
 * Schema de atualização de usuário.
 * Permite atualização parcial de username e/ou email,
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
    })
    .refine(
      (data) => data.username !== undefined || data.email !== undefined,
      {
        message: "Ao menos um campo (username ou email) deve ser fornecido para atualização.",
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
