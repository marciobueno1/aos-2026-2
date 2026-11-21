#!/usr/bin/env node

/**
 * Gera senhas criptograficamente aleatórias de 32 caracteres Base64
 * (`crypto.randomBytes(24).toString("base64")`, equivalente a `openssl rand -base64 24`),
 * rotaciona as senhas de `rwieruch` (ADMIN) e `ddavids` (USER) no banco configurado em
 * `express-01/.env` via `userService.updateUser` e atualiza `ADMIN_PASSWORD` e
 * `USER_PASSWORD` exclusivamente em `express-01/.env` (permissão 0600, ignorado pelo Git),
 * sem expor segredos no console ou gravar arquivos JSON em pastas versionadas.
 *
 * Uso:
 *   node auditoria/rotate-admin-password.mjs
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "../express-01/node_modules/dotenv/lib/main.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, "../express-01/.env");

if (!fs.existsSync(envPath)) {
  console.error(
    `Erro: arquivo '${envPath}' não encontrado. Copie express-01/.env.sample para express-01/.env antes de rotacionar as senhas.`
  );
  process.exit(1);
}

dotenv.config({ path: envPath, quiet: true });

const generateBase64Password = () => crypto.randomBytes(24).toString("base64");

const TARGET_USERS = [
  { username: "rwieruch", envKey: "ADMIN_PASSWORD" },
  { username: "ddavids", envKey: "USER_PASSWORD" },
];

const upsertEnvVars = (content, updates) => {
  const lines = content.split(/\r?\n/);
  const remaining = new Map(Object.entries(updates));

  const updatedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return line;
    }
    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) {
      return line;
    }
    const key = line.slice(0, eqIndex).trim();
    if (remaining.has(key)) {
      const val = remaining.get(key);
      remaining.delete(key);
      return `${key}=${val}`;
    }
    return line;
  });

  for (const [key, val] of remaining.entries()) {
    updatedLines.push(`${key}=${val}`);
  }

  return `${updatedLines.join("\n").replace(/\n+$/, "")}\n`;
};

const { default: models, sequelize } = await import(
  "../express-01/src/models/index.js"
);
const { default: userService } = await import(
  "../express-01/src/services/userService.js"
);

try {
  const envUpdates = {};

  for (const target of TARGET_USERS) {
    const user = await models.User.findOne({
      where: { username: target.username },
    });
    if (!user) {
      throw new Error(
        `Usuário '${target.username}' não encontrado no banco.`
      );
    }

    const previousHash = user.password;
    const newPassword = generateBase64Password();

    await userService.updateUser(
      user.id,
      { password: newPassword },
      { id: user.id, role: user.role }
    );

    const reloadedUser = await models.User.findByPk(user.id);
    const hashChanged = reloadedUser.password !== previousHash;
    const newIsValid = await reloadedUser.validatePassword(newPassword);

    if (!hashChanged || !newIsValid) {
      throw new Error(
        `Falha na verificação pós-rotação do hash Argon2 para '${target.username}'.`
      );
    }

    envUpdates[target.envKey] = newPassword;

    console.log(
      `Senha do usuário ${reloadedUser.role} '${reloadedUser.username}' rotacionada com sucesso no banco (hash atualizado=${hashChanged}, nova senha válida=${newIsValid}).`
    );
  }

  const currentEnvContent = fs.readFileSync(envPath, "utf8");
  const nextEnvContent = upsertEnvVars(currentEnvContent, envUpdates);
  fs.writeFileSync(envPath, nextEnvContent, { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(envPath, 0o600);

  console.log(
    `Variáveis ADMIN_PASSWORD e USER_PASSWORD atualizadas com permissão 0600 em: ${envPath}`
  );
} finally {
  await sequelize.close();
}
