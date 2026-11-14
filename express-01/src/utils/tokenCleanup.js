import "dotenv/config";
import { Op } from "sequelize";
import models, { sequelize } from "../models/index.js";

/**
 * Remove da base de dados todos os refresh tokens cuja data de expiração
 * seja anterior à data de referência informada.
 *
 * @param {Date} [referenceDate=new Date()]
 * @returns {Promise<number>} Quantidade de tokens removidos.
 */
export const cleanExpiredTokens = async (referenceDate = new Date()) => {
  const deletedCount = await models.RefreshToken.destroy({
    where: {
      expiresAt: {
        [Op.lt]: referenceDate,
      },
    },
  });
  return deletedCount;
};

/**
 * Executa a rotina de limpeza de refresh tokens expirados com logging e
 * fechamento seguro da conexão do Sequelize ao finalizar.
 *
 * @param {object} [options]
 * @param {boolean} [options.closeConnection=true]
 * @param {{ log: Function, error: Function }} [options.logger=console]
 * @returns {Promise<number | undefined>}
 */
export const runTokenCleanup = async ({
  closeConnection = true,
  logger = console,
} = {}) => {
  try {
    const deletedCount = await cleanExpiredTokens();
    logger.log(
      `[tokenCleanup] ${deletedCount} refresh token(s) expirado(s) removido(s).`
    );
    return deletedCount;
  } catch (error) {
    process.exitCode = 1;
    logger.error("[tokenCleanup] Falha ao limpar refresh tokens expirados:", error);
    return undefined;
  } finally {
    if (closeConnection) {
      await sequelize.close();
    }
  }
};

const STANDALONE_EVAL_IMPORT_REGEX =
  /^\s*(?:await\s+)?import\(\s*["'][^"']*tokenCleanup(?:\.js)?["']\s*\)\s*;?\s*$/;

/**
 * Determina se o módulo está sendo executado diretamente como utilitário CLI,
 * evitando efeitos colaterais quando importado pela aplicação ou suíte de testes.
 *
 * @param {object} [ctx]
 * @returns {boolean}
 */
export const isDirectCliExecution = ({
  nodeEnv = process.env.NODE_ENV,
  execArgv = process.execArgv,
  argv = process.argv,
  moduleUrl = import.meta.url,
} = {}) => {
  if (nodeEnv === "test") {
    return false;
  }

  return Boolean(
    execArgv.some((arg) => STANDALONE_EVAL_IMPORT_REGEX.test(arg)) ||
      (argv[1] && moduleUrl.endsWith(argv[1].replace(/\\/g, "/")))
  );
};

if (isDirectCliExecution()) {
  runTokenCleanup().catch(() => {
    process.exit(1);
  });
}

export default {
  cleanExpiredTokens,
  runTokenCleanup,
  isDirectCliExecution,
};
