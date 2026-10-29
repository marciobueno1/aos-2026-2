/**
 * Middleware genérico de validação com Zod.
 *
 * Recebe um schema Zod e valida de forma concorrente e assíncrona
 * as propriedades `body`, `params` e `query` de `req`.
 * Em caso de sucesso, atualiza os dados validados/sanitizados nas
 * respectivas propriedades da requisição e invoca next().
 * Em caso de falha, repassa o erro (ZodError) para o middleware global de erro.
 *
 * @param {import("zod").ZodType} schema - Schema Zod estruturado com body, params e/ou query
 * @returns {import("express").RequestHandler} Middleware Express assíncrono
 */
const validate = (schema) => async (req, res, next) => {
  try {
    const validated = await schema.parseAsync({
      body: req.body,
      params: req.params,
      query: req.query,
    });

    if (validated.body !== undefined) {
      req.body = validated.body;
    }
    if (validated.params !== undefined) {
      req.params = validated.params;
    }
    if (validated.query !== undefined) {
      req.query = validated.query;
    }

    return next();
  } catch (error) {
    return next(error);
  }
};

export default validate;
