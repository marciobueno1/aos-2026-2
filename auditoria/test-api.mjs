#!/usr/bin/env node

/**
 * Script de Teste Automatizado de Rotas (E2E) - AOS 2026.2
 *
 * Características:
 * - Ciclo completo (CRUD) com garantia de limpeza (cleanup) via try/finally.
 * - Testa rotas de sucesso e casos de erro do Middleware Global (Fase 2).
 * - Testa proteções de cabeçalhos com Helmet e controle de origens CORS (Fase 3).
 * - Testa limitação de taxa de requisições com express-rate-limit (Fase 4).
 * - Testa validação fail-fast de variáveis de ambiente com Zod no startup (Fase 5).
 * - Testa validação de payloads e parâmetros com Zod e mensagens normalizadas (Fase 6).
 * - Testa camada de autenticação com Argon2, JWT e Refresh Tokens com Rotação (Fase 7).
 * - Testa Controle de Acesso Baseado em Papéis (RBAC) e Validação de Propriedade (Fase 8).
 * - Testa Transações Atômicas, Limpeza de Tokens e Seeders Oficiais (Fase 9).
 * - Testa Documentação OpenAPI/Swagger, Paginação/Ordenação e Hardening de Payload 10kb (Fase 10).
 *
 * Uso:
 *   node auditoria/test-api.mjs [URL_BASE]
 *   Exemplo local:  node auditoria/test-api.mjs
 *   Exemplo prod:   node auditoria/test-api.mjs https://sua-api.vercel.app
 *   Observação:     lê ADMIN_PASSWORD do ambiente ou de express-01/.env.
 */

import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "../express-01/node_modules/dotenv/lib/main.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadAdminPassword() {
  const envPath = path.resolve(__dirname, "../express-01/.env");
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, quiet: true });
  }
  if (process.env.ADMIN_PASSWORD) {
    return process.env.ADMIN_PASSWORD;
  }
  throw new Error(
    "ADMIN_PASSWORD não encontrada no ambiente nem em express-01/.env. Configure ADMIN_PASSWORD no express-01/.env (ou execute `node auditoria/rotate-admin-password.mjs` / defina ADMIN_PASSWORD=... antes de rodar o E2E)."
  );
}

const ADMIN_PASSWORD = loadAdminPassword();
const BASE_URL = (process.argv[2] || process.env.API_URL || "http://localhost:4001").replace(/\/$/, "");

// Controle de recursos criados para cleanup em caso de interrupção ou falha
const resourcesToCleanup = {
  userIds: new Set(),
  messageIds: new Set(),
};

// Cores para o terminal
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
};

function logPass(msg) {
  console.log(`${colors.green}  ✓ [PASS]${colors.reset} ${msg}`);
}

function logFail(msg, detail) {
  console.error(`${colors.red}  ✗ [FAIL]${colors.reset} ${msg}`);
  if (detail) {
    console.error(`         ${colors.yellow}Detalhes:${colors.reset}`, detail);
  }
}

function logSection(title) {
  console.log(`\n${colors.bold}${colors.cyan}=== ${title} ===${colors.reset}`);
}

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
let totalHttpRequests = 0;

function assert(condition, message, details = "") {
  totalTests++;
  if (condition) {
    passedTests++;
    logPass(message);
  } else {
    failedTests++;
    logFail(message, details);
    throw new Error(`Falha no teste: ${message}`);
  }
}

let defaultAuthToken = null;

function setDefaultAuthToken(token) {
  defaultAuthToken = token;
}

async function request(endpoint, options = {}) {
  totalHttpRequests++;
  const url = `${BASE_URL}${endpoint}`;
  const headers = {
    "Content-Type": "application/json",
    ...(defaultAuthToken && !options.skipAuth
      ? { Authorization: `Bearer ${defaultAuthToken}` }
      : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  let data = null;
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  } else {
    data = await response.text();
  }

  return { status: response.status, data, headers: response.headers };
}

// Procedimento emergencial de cleanup se o usuário cancelar com Ctrl+C
async function cleanupAll() {
  if (resourcesToCleanup.messageIds.size === 0 && resourcesToCleanup.userIds.size === 0) {
    return;
  }

  console.log(`\n${colors.yellow}Realizando limpeza de recursos criados no banco de dados...${colors.reset}`);

  for (const messageId of resourcesToCleanup.messageIds) {
    try {
      await request(`/messages/${messageId}`, { method: "DELETE" });
      console.log(`  - Mensagem ID ${messageId} removida.`);
    } catch (e) {
      console.error(`  - Falha ao remover mensagem ID ${messageId}:`, e.message);
    }
  }
  resourcesToCleanup.messageIds.clear();

  for (const userId of resourcesToCleanup.userIds) {
    try {
      await request(`/users/${userId}`, { method: "DELETE" });
      console.log(`  - Usuário ID ${userId} removido.`);
    } catch (e) {
      console.error(`  - Falha ao remover usuário ID ${userId}:`, e.message);
    }
  }
  resourcesToCleanup.userIds.clear();
}

process.on("SIGINT", async () => {
  console.log("\nExecução interrompida pelo usuário (SIGINT).");
  await cleanupAll();
  process.exit(1);
});

async function runTestSuite() {
  console.log(`${colors.bold}Iniciando bateria de testes contra:${colors.reset} ${BASE_URL}`);

  try {
    // ---------------------------------------------------------
    // 1. Rota raiz, Sessão e Verificação do Seed Inicial
    // ---------------------------------------------------------
    logSection("1. Conectividade, Sessão e Validação do Seed Inicial");

    const rootRes = await request("/");
    assert(rootRes.status === 200, "GET / deve retornar 200 OK");

    // Autentica inicialmente com o usuário do seed rwieruch para habilitar requisições autenticadas na suite
    const initLoginRes = await request("/session", {
      method: "POST",
      body: JSON.stringify({ login: "rwieruch", password: ADMIN_PASSWORD }),
      skipAuth: true,
    });
    let initRefreshToken = null;
    if (initLoginRes.status === 200 && (initLoginRes.data?.token || initLoginRes.data?.accessToken)) {
      setDefaultAuthToken(initLoginRes.data.token || initLoginRes.data.accessToken);
      initRefreshToken = initLoginRes.data?.refreshToken || null;
    }

    const sessionRes = await request("/session");
    assert(sessionRes.status === 200, "GET /session deve retornar 200 OK");
    assert(sessionRes.data && sessionRes.data.username, "GET /session deve conter objeto do usuário logado");

    // Validação do Seed Inicial (exatamente 2 usuários cadastrados: rwieruch e ddavids)
    const initialUsersRes = await request("/users");
    assert(initialUsersRes.status === 200, "GET /users inicial deve retornar 200 OK");
    assert(Array.isArray(initialUsersRes.data), "GET /users deve retornar uma lista");
    assert(
      initialUsersRes.data.length === 2,
      `O seed inicial deve conter exatamente 2 usuários (encontrados: ${initialUsersRes.data.length})`,
      initialUsersRes.data.map((u) => `${u.username} (${u.id})`)
    );
    const initialUsernames = initialUsersRes.data.map((u) => u.username);
    assert(initialUsernames.includes("rwieruch"), "Usuário 'rwieruch' deve estar presente no seed");
    assert(initialUsernames.includes("ddavids"), "Usuário 'ddavids' deve estar presente no seed");

    const initialMessagesRes = await request("/messages");
    assert(initialMessagesRes.status === 200, "GET /messages inicial deve retornar 200 OK");
    const initialMessagesCount = Array.isArray(initialMessagesRes.data) ? initialMessagesRes.data.length : 0;

    // ---------------------------------------------------------
    // 2. Ciclo de Vida do Usuário (CRUD com rollback)
    // ---------------------------------------------------------
    logSection("2. Ciclo de Vida de Usuário (CRUD)");

    const uniqueStamp = Date.now();
    const testUsername = `test_u_${uniqueStamp}`;
    const testEmail = `test_${uniqueStamp}@unicap.br`;
    let createdUserId = null;

    try {
      // POST /users
      const postUserRes = await request("/users", {
        method: "POST",
        body: JSON.stringify({
          username: testUsername,
          email: testEmail,
          password: "TestPassword123!",
        }),
      });
      assert(postUserRes.status === 201, "POST /users deve retornar 201 Created", postUserRes.data);
      assert(postUserRes.data?.id, "POST /users deve retornar o ID gerado", postUserRes.data);
      createdUserId = postUserRes.data.id;
      resourcesToCleanup.userIds.add(createdUserId);

      // GET /users/:userId
      const getUserRes = await request(`/users/${createdUserId}`);
      assert(getUserRes.status === 200, `GET /users/${createdUserId} deve retornar 200 OK`, getUserRes.data);
      assert(getUserRes.data?.username === testUsername, "GET /users/:userId deve conter o username cadastrado");

      // PUT /users/:userId
      const updatedUsername = `${testUsername}_edit`;
      const putUserRes = await request(`/users/${createdUserId}`, {
        method: "PUT",
        body: JSON.stringify({ username: updatedUsername }),
      });
      assert(putUserRes.status === 200, `PUT /users/${createdUserId} deve retornar 200 OK`, putUserRes.data);
      assert(putUserRes.data?.username === updatedUsername, "PUT /users/:userId deve refletir a alteração");

      // GET /users (Listagem)
      const listUsersRes = await request("/users");
      assert(listUsersRes.status === 200, "GET /users deve retornar 200 OK");
      assert(Array.isArray(listUsersRes.data), "GET /users deve retornar um array");
      const foundInList = listUsersRes.data.some((u) => u.id === createdUserId);
      assert(foundInList, "GET /users deve conter a entidade recém-criada na lista");
    } finally {
      // DELETE /users/:userId (Garantia de limpeza mesmo em caso de erro no meio)
      if (createdUserId) {
        const delUserRes = await request(`/users/${createdUserId}`, { method: "DELETE" });
        assert(delUserRes.status === 204, `DELETE /users/${createdUserId} deve retornar 204 No Content`);
        resourcesToCleanup.userIds.delete(createdUserId);

        // Confirmação de remoção: GET /users/:userId deve retornar 404 com JSON padronizado
        const checkDeletedRes = await request(`/users/${createdUserId}`);
        assert(checkDeletedRes.status === 404, `GET /users/${createdUserId} após exclusão deve retornar 404 Not Found`);
        assert(checkDeletedRes.data?.status === "fail", "404 de usuário inexistente deve retornar status 'fail'");
        assert(checkDeletedRes.data?.message === "Usuário não encontrado.", "404 deve conter mensagem 'Usuário não encontrado.'");
      }
    }

    // ---------------------------------------------------------
    // 3. Ciclo de Vida de Mensagem (CRUD com rollback)
    // ---------------------------------------------------------
    logSection("3. Ciclo de Vida de Mensagem (CRUD)");

    const testMessageText = `Mensagem de teste automatizado [${uniqueStamp}]`;
    let createdMessageId = null;

    try {
      // POST /messages
      const postMsgRes = await request("/messages", {
        method: "POST",
        body: JSON.stringify({ text: testMessageText }),
      });
      assert(postMsgRes.status === 201, "POST /messages deve retornar 201 Created", postMsgRes.data);
      assert(postMsgRes.data?.id, "POST /messages deve retornar o ID gerado", postMsgRes.data);
      createdMessageId = postMsgRes.data.id;
      resourcesToCleanup.messageIds.add(createdMessageId);

      // GET /messages/:messageId
      const getMsgRes = await request(`/messages/${createdMessageId}`);
      assert(getMsgRes.status === 200, `GET /messages/${createdMessageId} deve retornar 200 OK`, getMsgRes.data);
      assert(getMsgRes.data?.text === testMessageText, "GET /messages/:messageId deve retornar o texto correto");

      // PUT /messages/:messageId
      const updatedMessageText = `${testMessageText} (editada)`;
      const putMsgRes = await request(`/messages/${createdMessageId}`, {
        method: "PUT",
        body: JSON.stringify({ text: updatedMessageText }),
      });
      assert(putMsgRes.status === 200, `PUT /messages/${createdMessageId} deve retornar 200 OK`, putMsgRes.data);
      assert(putMsgRes.data?.text === updatedMessageText, "PUT /messages/:messageId deve refletir a alteração");

      // GET /messages (Listagem)
      const listMsgsRes = await request("/messages");
      assert(listMsgsRes.status === 200, "GET /messages deve retornar 200 OK");
      assert(Array.isArray(listMsgsRes.data), "GET /messages deve retornar um array");
      const foundMsgInList = listMsgsRes.data.some((m) => m.id === createdMessageId);
      assert(foundMsgInList, "GET /messages deve conter a mensagem recém-criada na lista");
    } finally {
      // DELETE /messages/:messageId (Garantia de limpeza)
      if (createdMessageId) {
        const delMsgRes = await request(`/messages/${createdMessageId}`, { method: "DELETE" });
        assert(delMsgRes.status === 204, `DELETE /messages/${createdMessageId} deve retornar 204 No Content`);
        resourcesToCleanup.messageIds.delete(createdMessageId);

        // Confirmação de remoção: GET /messages/:messageId deve retornar 404 com JSON padronizado
        const checkDeletedMsgRes = await request(`/messages/${createdMessageId}`);
        assert(checkDeletedMsgRes.status === 404, `GET /messages/${createdMessageId} após exclusão deve retornar 404 Not Found`);
        assert(checkDeletedMsgRes.data?.status === "fail", "404 de mensagem inexistente deve retornar status 'fail'");
        assert(checkDeletedMsgRes.data?.message === "Mensagem não encontrada.", "404 deve conter mensagem 'Mensagem não encontrada.'");
      }
    }

    // ---------------------------------------------------------
    // 4. Validação de Erros e Middleware Global (Fase 2)
    // ---------------------------------------------------------
    logSection("4. Validação de Erros e Formato JSON Padronizado (Fase 2)");

    // Rota Inexistente -> 404 com JSON padronizado
    const notFoundRes = await request(`/rota-inexistente-${uniqueStamp}`);
    assert(notFoundRes.status === 404, "Rota inexistente deve responder HTTP 404");
    assert(notFoundRes.data?.status === "fail", "Rota inexistente deve ter status: 'fail'", notFoundRes.data);
    assert(typeof notFoundRes.data?.message === "string", "Resposta de erro 404 deve conter propriedade 'message'");

    // Conflito de Unicidade -> 409 Conflict ao tentar cadastrar usuário existente
    const duplicateUserRes = await request("/users", {
      method: "POST",
      body: JSON.stringify({
        username: "rwieruch",
        email: "rwieruch@email.com",
        password: "TestPassword123!",
      }),
    });
    assert(duplicateUserRes.status === 409, "POST /users duplicado deve retornar HTTP 409 Conflict");
    assert(duplicateUserRes.data?.status === "fail", "SequelizeUniqueConstraintError deve ter status: 'fail'", duplicateUserRes.data);
    assert(typeof duplicateUserRes.data?.message === "string", "SequelizeUniqueConstraintError deve conter propriedade 'message'");

    // UUID Inexistente -> 404 Not Found com JSON estruturado
    const nonExistentUuidRes = await request("/users/00000000-0000-0000-0000-000000000000");
    assert(nonExistentUuidRes.status === 404, "GET /users com UUID inexistente deve retornar HTTP 404");
    assert(nonExistentUuidRes.data?.status === "fail", "Busca por UUID inexistente deve retornar status 'fail'");
    assert(nonExistentUuidRes.data?.message === "Usuário não encontrado.", "Mensagem deve ser 'Usuário não encontrado.'");

    // ---------------------------------------------------------
    // 5. Segurança com Helmet e CORS Limpo (Fase 3)
    // ---------------------------------------------------------
    logSection("5. Segurança com Helmet e CORS Limpo (Fase 3)");

    // 5.1 Helmet: Não deve exibir X-Powered-By e deve injetar cabeçalhos de proteção (validado em rootRes)
    assert(
      !rootRes.headers.has("x-powered-by"),
      "Helmet: Cabeçalho 'X-Powered-By' não deve ser exibido"
    );
    assert(
      rootRes.headers.get("x-content-type-options") === "nosniff",
      "Helmet: Cabeçalho 'X-Content-Type-Options' deve ser 'nosniff'"
    );
    assert(
      rootRes.headers.has("x-frame-options"),
      "Helmet: Cabeçalho 'X-Frame-Options' deve estar presente"
    );

    // 5.2 CORS: Origem autorizada (deve incluir Access-Control-Allow-Origin e credentials)
    const corsAllowedRes = await request("/", {
      headers: { Origin: "http://localhost:3000" },
    });
    assert(
      corsAllowedRes.status === 200,
      "CORS: Requisição com origem autorizada deve retornar HTTP 200"
    );
    assert(
      corsAllowedRes.headers.get("access-control-allow-origin") === "http://localhost:3000",
      "CORS: Cabeçalho 'Access-Control-Allow-Origin' deve refletir a origem permitida 'http://localhost:3000'"
    );
    assert(
      corsAllowedRes.headers.get("access-control-allow-credentials") === "true",
      "CORS: Cabeçalho 'Access-Control-Allow-Credentials' deve ser 'true'"
    );

    // 5.3 CORS: Preflight (OPTIONS) com origem autorizada
    const preflightAllowedRes = await request("/", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:3000",
        "Access-Control-Request-Method": "GET",
      },
    });
    assert(
      preflightAllowedRes.status === 204,
      "CORS: Preflight OPTIONS com origem autorizada deve retornar HTTP 204"
    );
    assert(
      preflightAllowedRes.headers.get("access-control-allow-origin") === "http://localhost:3000",
      "CORS: Preflight OPTIONS deve conter 'Access-Control-Allow-Origin'"
    );

    // 5.4 CORS: Origem não autorizada (bloqueio 403 com AppError logado no servidor)
    const corsDisallowedRes = await request("/", {
      headers: { Origin: "http://site-malicioso.com" },
    });
    assert(
      corsDisallowedRes.status === 403,
      "CORS: Origem não autorizada deve responder HTTP 403 Forbidden com log no servidor"
    );
    assert(
      corsDisallowedRes.data && corsDisallowedRes.data.status === "fail",
      "CORS: Origem não autorizada deve responder com 'status: fail' formatado pelo errorMiddleware"
    );
    assert(
      !corsDisallowedRes.headers.has("access-control-allow-origin"),
      "CORS: Origem não autorizada NÃO deve receber o cabeçalho 'Access-Control-Allow-Origin'"
    );

    // 5.5 CORS: Preflight (OPTIONS) com origem não autorizada (rejeição 403 pelo errorMiddleware)
    const preflightDisallowedRes = await request("/", {
      method: "OPTIONS",
      headers: {
        Origin: "http://site-malicioso.com",
        "Access-Control-Request-Method": "GET",
      },
    });
    assert(
      preflightDisallowedRes.status === 403,
      "CORS: Preflight OPTIONS de origem não autorizada deve responder HTTP 403 Forbidden"
    );
    assert(
      !preflightDisallowedRes.headers.has("access-control-allow-origin"),
      "CORS: Preflight de origem não autorizada NÃO deve receber 'Access-Control-Allow-Origin'"
    );

    // 5.6 Chamada direta / mobile (sem cabeçalho Origin - validado em initialUsersRes)
    assert(
      initialUsersRes.status === 200,
      "CORS Mobile/Direct: Chamada direta sem cabeçalho Origin deve responder HTTP 200"
    );

    // ---------------------------------------------------------
    // 6. Controle de Taxa de Requisições (Rate Limiting - Passo 4)
    // ---------------------------------------------------------
    logSection("6. Controle de Taxa de Requisições (Rate Limiting - Passo 4)");

    assert(
      rootRes.headers.has("ratelimit"),
      "RateLimit: Resposta da raiz deve conter cabeçalho padrão draft-7 ('ratelimit')"
    );
    assert(
      rootRes.headers.get("ratelimit")?.includes("limit=100"),
      "RateLimit: Cabeçalho 'ratelimit' deve definir o limite de 100 requisições (limiterMiddleware)"
    );
    assert(
      rootRes.headers.get("x-ratelimit-limit") === "100",
      "RateLimit: Cabeçalho legado 'X-RateLimit-Limit' deve ser '100'"
    );
    assert(
      rootRes.headers.has("x-ratelimit-remaining"),
      "RateLimit: Cabeçalho 'X-RateLimit-Remaining' deve estar presente na resposta"
    );
    assert(
      rootRes.headers.has("x-ratelimit-reset"),
      "RateLimit: Cabeçalho 'X-RateLimit-Reset' deve estar presente na resposta"
    );

    // ---------------------------------------------------------
    // 7. Auditoria de Integridade Pós-CRUD (validada ao longo das Fases 8 e 10)
    // ---------------------------------------------------------
    logSection("7. Auditoria de Integridade Pós-CRUD (Estado Limpo)");
    assert(
      initialUsersRes.data.length === 2 && initialMessagesCount >= 3,
      "Estado inicial do seed validado antes dos testes avançados"
    );

    // ---------------------------------------------------------
    // 9. Validação de Variáveis de Ambiente no Startup (Passo 5)
    // ---------------------------------------------------------
    logSection("9. Validação de Variáveis de Ambiente no Startup com Zod (Passo 5)");

    const projectRoot = new URL("../express-01", import.meta.url).pathname;

    // 9.1 Fail-Fast: DATABASE_URL ausente
    const noDbRes = spawnSync(
      "node",
      ["-e", 'import("./src/utils/env.js")'],
      {
        cwd: projectRoot,
        env: {
          PATH: process.env.PATH,
          PORT: "4001",
          ALLOWED_ORIGINS: "http://localhost:3000",
          JWT_SECRET: "segredo-ficticio-apenas-teste-e2e",
        },
      }
    );
    assert(
      noDbRes.status === 1,
      "Env Fail-Fast: Omissão de DATABASE_URL deve abortar o processo com exit code 1"
    );
    const noDbStderr = noDbRes.stderr.toString();
    assert(
      noDbStderr.includes("DATABASE_URL"),
      "Env Fail-Fast: Erro no terminal deve apontar falha em DATABASE_URL",
      noDbStderr
    );

    // 9.2 Fail-Fast: PORT com valor inválido (não numérico)
    const invalidPortRes = spawnSync(
      "node",
      ["-e", 'import("./src/utils/env.js")'],
      {
        cwd: projectRoot,
        env: {
          PATH: process.env.PATH,
          DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
          PORT: "porta-invalida",
          ALLOWED_ORIGINS: "http://localhost:3000",
          JWT_SECRET: "segredo-ficticio-apenas-teste-e2e",
        },
      }
    );
    assert(
      invalidPortRes.status === 1,
      "Env Fail-Fast: PORT não numérico deve abortar o processo com exit code 1"
    );

    // 9.3 Valor Padrão: PORT omitido deve assumir 4001 (número)
    const defaultPortRes = spawnSync(
      "node",
      [
        "-e",
        'import("./src/utils/env.js").then(({ env }) => { console.log(JSON.stringify({ port: env.PORT, type: typeof env.PORT })); })',
      ],
      {
        cwd: projectRoot,
        env: {
          PATH: process.env.PATH,
          DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
          ALLOWED_ORIGINS: "http://localhost:3000",
          JWT_SECRET: "segredo-ficticio-apenas-teste-e2e",
        },
      }
    );
    assert(
      defaultPortRes.status === 0,
      "Env Default: Inicialização sem PORT explícito deve ter sucesso (exit code 0)"
    );
    let defaultPortData = {};
    try {
      defaultPortData = JSON.parse(defaultPortRes.stdout.toString().trim());
    } catch {}
    assert(
      defaultPortData.port === 4001 && defaultPortData.type === "number",
      "Env Default: PORT deve ter valor numérico padrão 4001 quando omitido",
      defaultPortData
    );

    // 9.4 Fail-Fast: ALLOWED_ORIGINS ausente
    const noOriginsRes = spawnSync(
      "node",
      ["-e", 'import("./src/utils/env.js")'],
      {
        cwd: projectRoot,
        env: {
          PATH: process.env.PATH,
          DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
          PORT: "4001",
          JWT_SECRET: "segredo-ficticio-apenas-teste-e2e",
        },
      }
    );
    assert(
      noOriginsRes.status === 1,
      "Env Fail-Fast: Omissão de ALLOWED_ORIGINS deve abortar o processo com exit code 1"
    );

    // 9.5 Fail-Fast: JWT_SECRET muito curto (< 10 caracteres)
    const shortSecretRes = spawnSync(
      "node",
      ["-e", 'import("./src/utils/env.js")'],
      {
        cwd: projectRoot,
        env: {
          PATH: process.env.PATH,
          DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
          PORT: "4001",
          ALLOWED_ORIGINS: "http://localhost:3000",
          JWT_SECRET: "curto",
        },
      }
    );
    assert(
      shortSecretRes.status === 1,
      "Env Fail-Fast: JWT_SECRET com menos de 10 caracteres deve abortar o processo com exit code 1"
    );

    // 9.6 Sucesso com ambiente completo válido
    const validEnvRes = spawnSync(
      "node",
      [
        "-e",
        'import("./src/utils/env.js").then(({ env }) => { console.log("OK"); })',
      ],
      {
        cwd: projectRoot,
        env: {
          PATH: process.env.PATH,
          DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
          PORT: "4001",
          NODE_ENV: "production",
          ALLOWED_ORIGINS: "http://localhost:3000,http://localhost:3001",
          JWT_SECRET: "segredo-ficticio-apenas-teste-e2e",
        },
      }
    );
    assert(
      validEnvRes.status === 0,
      "Env Sucesso: Variáveis válidas e completas devem inicializar com exit code 0"
    );

    // ---------------------------------------------------------
    // 10. Validação de Requisições com Zod (Passo 6)
    // ---------------------------------------------------------
    logSection("10. Middleware de Validação de Requisições com Zod (Passo 6)");

    // 10.1 POST /users com payload vazio {} (múltiplas falhas estruturadas: username, email e password)
    const userEmptyBodyRes = await request("/users", {
      method: "POST",
      body: JSON.stringify({}),
    });
    assert(
      userEmptyBodyRes.status === 400,
      "Zod POST /users: Payload vazio deve responder HTTP 400 Bad Request"
    );
    assert(
      userEmptyBodyRes.data?.status === "fail",
      "Zod POST /users: Resposta de erro deve conter 'status: fail'"
    );
    assert(
      userEmptyBodyRes.data?.errors?.length >= 2,
      "Zod POST /users: Payload vazio deve listar múltiplos erros no array 'errors'"
    );
    assert(
      userEmptyBodyRes.data?.errors?.some((e) => e.startsWith("body.username:")),
      "Zod POST /users: 'errors' deve conter detalhe com prefixo 'body.username:'"
    );
    assert(
      userEmptyBodyRes.data?.errors?.some((e) => e.startsWith("body.email:")),
      "Zod POST /users: 'errors' deve conter detalhe com prefixo 'body.email:'"
    );
    assert(
      userEmptyBodyRes.data?.message?.includes("body.email:") &&
        userEmptyBodyRes.data?.message?.includes("; "),
      "Zod POST /users: Mensagens múltiplas devem ser concatenadas com '; '"
    );

    // 10.2 POST /users com formato de e-mail inválido
    const userInvalidEmailRes = await request("/users", {
      method: "POST",
      body: JSON.stringify({ username: "teste_inv_email", email: "formato_invalido" }),
    });
    assert(
      userInvalidEmailRes.status === 400,
      "Zod POST /users: Formato de e-mail inválido deve responder HTTP 400 Bad Request"
    );
    assert(
      Array.isArray(userInvalidEmailRes.data?.errors) &&
        userInvalidEmailRes.data.errors.some((e) =>
          e.includes("Formato de e-mail inválido")
        ),
      "Zod POST /users: 'errors' deve detalhar 'Formato de e-mail inválido'"
    );

    // 10.4 GET /users/:userId com UUID inválido
    const userGetInvalidUuidRes = await request("/users/id-invalido-123");
    assert(
      userGetInvalidUuidRes.status === 400,
      "Zod GET /users/:userId: UUID inválido deve responder HTTP 400 Bad Request"
    );
    assert(
      userGetInvalidUuidRes.data?.status === "fail",
      "Zod GET /users/:userId: Resposta deve conter 'status: fail'"
    );
    assert(
      Array.isArray(userGetInvalidUuidRes.data?.errors) &&
        userGetInvalidUuidRes.data.errors.some((e) => e.startsWith("params.userId:")),
      "Zod GET /users/:userId: 'errors' deve conter detalhe com prefixo 'params.userId:'"
    );

    // 10.5 PUT /users/:userId com UUID inválido
    const userPutInvalidUuidRes = await request("/users/id-invalido-123", {
      method: "PUT",
      body: JSON.stringify({ username: "novo_nome" }),
    });
    assert(
      userPutInvalidUuidRes.status === 400,
      "Zod PUT /users/:userId: UUID inválido deve responder HTTP 400 Bad Request"
    );
    assert(
      Array.isArray(userPutInvalidUuidRes.data?.errors) &&
        userPutInvalidUuidRes.data.errors.some((e) => e.startsWith("params.userId:")),
      "Zod PUT /users/:userId: 'errors' deve conter prefixo 'params.userId:'"
    );

    // 10.6 PUT /users/:userId com payload vazio {}
    const userPutEmptyBodyRes = await request(
      "/users/00000000-0000-0000-0000-000000000000",
      {
        method: "PUT",
        body: JSON.stringify({}),
      }
    );
    assert(
      userPutEmptyBodyRes.status === 400,
      "Zod PUT /users/:userId: Payload sem campos de alteração deve responder HTTP 400 Bad Request"
    );

    // 10.9 POST /messages sem campo text
    const msgNoTextRes = await request("/messages", {
      method: "POST",
      body: JSON.stringify({}),
    });
    assert(
      msgNoTextRes.status === 400,
      "Zod POST /messages: Omissão de texto deve responder HTTP 400 Bad Request"
    );
    assert(
      Array.isArray(msgNoTextRes.data?.errors) &&
        msgNoTextRes.data.errors.some((e) => e.startsWith("body.text:")),
      "Zod POST /messages: 'errors' deve conter detalhe com prefixo 'body.text:'"
    );

    // 10.10 POST /messages com text vazio ou somente espaços
    const msgEmptyTextRes = await request("/messages", {
      method: "POST",
      body: JSON.stringify({ text: "     " }),
    });
    assert(
      msgEmptyTextRes.status === 400,
      "Zod POST /messages: Texto composto somente por espaços deve responder HTTP 400 Bad Request"
    );

    // 10.11 POST /messages com texto excedendo 1000 caracteres
    const msgExceedTextRes = await request("/messages", {
      method: "POST",
      body: JSON.stringify({ text: "a".repeat(1001) }),
    });
    assert(
      msgExceedTextRes.status === 400,
      "Zod POST /messages: Texto acima de 1000 caracteres deve responder HTTP 400 Bad Request"
    );
    assert(
      Array.isArray(msgExceedTextRes.data?.errors) &&
        msgExceedTextRes.data.errors.some((e) =>
          e.includes("Texto deve ter no máximo 1000 caracteres")
        ),
      "Zod POST /messages: 'errors' deve indicar limite máximo de 1000 caracteres"
    );

    // 10.12 GET /messages/:messageId com UUID inválido
    const msgGetInvalidUuidRes = await request("/messages/id-invalido-123");
    assert(
      msgGetInvalidUuidRes.status === 400,
      "Zod GET /messages/:messageId: UUID inválido deve responder HTTP 400 Bad Request"
    );
    assert(
      Array.isArray(msgGetInvalidUuidRes.data?.errors) &&
        msgGetInvalidUuidRes.data.errors.some((e) => e.startsWith("params.messageId:")),
      "Zod GET /messages/:messageId: 'errors' deve conter detalhe com prefixo 'params.messageId:'"
    );

    // 10.12 PUT /messages/:messageId com UUID inválido
    const msgPutInvalidUuidRes = await request("/messages/id-invalido-123", {
      method: "PUT",
      body: JSON.stringify({ text: "Mensagem editada" }),
    });
    assert(
      msgPutInvalidUuidRes.status === 400,
      "Zod PUT /messages/:messageId: UUID inválido deve responder HTTP 400 Bad Request"
    );

    // 10.13 PUT /messages/:messageId com texto vazio
    const msgPutEmptyTextRes = await request(
      "/messages/00000000-0000-0000-0000-000000000000",
      {
        method: "PUT",
        body: JSON.stringify({ text: "" }),
      }
    );
    assert(
      msgPutEmptyTextRes.status === 400,
      "Zod PUT /messages/:messageId: Texto vazio deve responder HTTP 400 Bad Request"
    );

    // ---------------------------------------------------------
    // 11. Fase 7: Autenticação Segura (Argon2, JWT e Refresh Tokens)
    // ---------------------------------------------------------
    logSection("11. Fase 7: Autenticação Segura (Argon2, JWT e Refresh Tokens)");

    const authTestStamp = Date.now();
    const authUsername = `auth_u_${authTestStamp}`;
    const authEmailRaw = `Auth_${authTestStamp}@UNICAP.BR`;
    const authEmail = authEmailRaw.toLowerCase();
    const authPassword = "TestPassword123!";
    let authUserId = null;
    let userAccessTokenForRbac = null;

    try {
      // 11.1 Registro de usuário e sanitização de credenciais (CWE-200)
      const registerRes = await request("/users", {
        method: "POST",
        body: JSON.stringify({
          username: authUsername,
          email: authEmailRaw,
          password: authPassword,
          role: "ADMIN", // Tentativa de injeção de role no cadastro deve ser ignorada
        }),
        skipAuth: true,
      });
      assert(registerRes.status === 201, "Fase 7 POST /users: Cadastro com senha deve responder 201 Created");
      assert(registerRes.data?.id, "Fase 7 POST /users: Retorno deve conter o ID gerado");
      assert(registerRes.data?.email === authEmail, "Fase 10 S6 POST /users: E-mail com maiúsculas deve ser normalizado para minúsculas");
      assert(registerRes.data?.password === undefined, "Fase 7 Segurança CWE-200: A senha/hash NUNCA deve ser retornada no cadastro");
      assert(registerRes.data?.role === "USER", "Fase 8 RBAC: Cadastro público deve sempre atribuir role 'USER'");
      authUserId = registerRes.data.id;
      resourcesToCleanup.userIds.add(authUserId);

      // 11.2 Tentativa de Login com senha incorreta
      const wrongPassRes = await request("/session", {
        method: "POST",
        body: JSON.stringify({ login: authUsername, password: "senha_errada_123" }),
        skipAuth: true,
      });
      assert(wrongPassRes.status === 401, "Fase 7 POST /session: Senha incorreta deve responder HTTP 401 Unauthorized");
      assert(wrongPassRes.data?.status === "fail", "Fase 7 POST /session: Falha de autenticação deve retornar status 'fail'");
      assert(wrongPassRes.data?.message === "Credenciais inválidas.", "Fase 7 POST /session: Mensagem de erro neutra 'Credenciais inválidas.'");

      // 11.3 Tentativa de Login com login inexistente
      const nonExistentLoginRes = await request("/session", {
        method: "POST",
        body: JSON.stringify({ login: "usuario_que_nao_existe", password: authPassword }),
        skipAuth: true,
      });
      assert(nonExistentLoginRes.status === 401, "Fase 7 POST /session: Usuário inexistente deve responder HTTP 401 Unauthorized");

      // 11.4 Login bem-sucedido com username e emissão do par de tokens
      const loginByUsernameRes = await request("/session", {
        method: "POST",
        body: JSON.stringify({ login: authUsername, password: authPassword }),
        skipAuth: true,
      });
      assert(loginByUsernameRes.status === 200, "Fase 7 POST /session: Login com username deve responder HTTP 200 OK");
      assert(
        Boolean(loginByUsernameRes.data?.token || loginByUsernameRes.data?.accessToken),
        "Fase 7 POST /session: Resposta deve conter o Access Token JWT (token ou accessToken)"
      );
      assert(
        Boolean(loginByUsernameRes.data?.refreshToken),
        "Fase 7 POST /session: Resposta deve conter o Refresh Token persistido"
      );
      assert(
        typeof loginByUsernameRes.data?.refreshToken === "string" &&
          loginByUsernameRes.data.refreshToken.length === 80,
        "Fase 7 POST /session: Refresh Token deve ser string hexadecimal opaca de 40 bytes (80 chars)"
      );
      const userAccessToken = loginByUsernameRes.data.token || loginByUsernameRes.data.accessToken;
      userAccessTokenForRbac = userAccessToken;
      let activeRefreshToken = loginByUsernameRes.data.refreshToken;

      // 11.5 Login bem-sucedido com e-mail (incluindo maiúsculas normalizadas no findByLogin)
      const loginByEmailRes = await request("/session", {
        method: "POST",
        body: JSON.stringify({ login: authEmailRaw, password: authPassword }),
        skipAuth: true,
      });
      assert(loginByEmailRes.status === 200, "Fase 7/10 POST /session: Login com e-mail (maiúsculas) deve normalizar e responder HTTP 200 OK");
      const emailRefreshToken = loginByEmailRes.data?.refreshToken;

      // 11.6 Acesso a rota autenticada GET /session usando o JWT
      const authenticatedSessionRes = await request("/session", {
        method: "GET",
        headers: { Authorization: `Bearer ${userAccessToken}` },
        skipAuth: true,
      });
      assert(authenticatedSessionRes.status === 200, "Fase 7 GET /session: Token JWT válido deve retornar 200 OK");
      assert(authenticatedSessionRes.data?.id === authUserId, "Fase 7 GET /session: Objeto da sessão deve corresponder ao usuário logado");
      assert(authenticatedSessionRes.data?.password === undefined, "Fase 7 GET /session: Sessão não deve vazar hash de senha");

      // 11.7 Bloqueio de rota privada sem cabeçalho Authorization
      const unauthSessionRes = await request("/session", {
        method: "GET",
        skipAuth: true,
      });
      assert(unauthSessionRes.status === 401, "Fase 7 protectRoutes: GET /session sem token deve responder 401 Unauthorized");
      assert(unauthSessionRes.data?.status === "fail", "Fase 7 protectRoutes: Bloqueio sem token deve retornar status 'fail'");

      // 11.8 Bloqueio de rota privada com token inválido
      const invalidTokenRes = await request("/session", {
        method: "GET",
        headers: { Authorization: "Bearer token-completamente-falso-e-invalido" },
        skipAuth: true,
      });
      assert(invalidTokenRes.status === 401, "Fase 7 authMiddleware: Token inválido deve responder 401 Unauthorized");

      // 11.9 Renovação de Token com Rotação (POST /session/refresh)
      const refreshRes = await request("/session/refresh", {
        method: "POST",
        body: JSON.stringify({ refreshToken: activeRefreshToken }),
        skipAuth: true,
      });
      assert(refreshRes.status === 200, "Fase 7 POST /session/refresh: Renovação válida deve responder 200 OK");
      const rotatedAccessToken = refreshRes.data?.token || refreshRes.data?.accessToken;
      const rotatedRefreshToken = refreshRes.data?.refreshToken;
      assert(Boolean(rotatedAccessToken), "Fase 7 POST /session/refresh: Deve emitir novo Access Token");
      assert(Boolean(rotatedRefreshToken), "Fase 7 POST /session/refresh: Deve emitir novo Refresh Token rotacionado");
      assert(rotatedRefreshToken !== activeRefreshToken, "Fase 7 Rotação Obrigatória: Novo Refresh Token deve ser diferente do consumido");

      // 11.10 Contenção de Reuso: Tentar reutilizar o refresh token antigo deve falhar com 401
      const reuseAttemptRes = await request("/session/refresh", {
        method: "POST",
        body: JSON.stringify({ refreshToken: activeRefreshToken }),
        skipAuth: true,
      });
      assert(reuseAttemptRes.status === 401, "Fase 7 Rotação: Reuso de token já rotacionado deve falhar com HTTP 401");

      // 11.11 Validação do novo Access Token após rotação
      const checkRotatedAccessRes = await request("/session", {
        method: "GET",
        headers: { Authorization: `Bearer ${rotatedAccessToken}` },
        skipAuth: true,
      });
      assert(checkRotatedAccessRes.status === 200, "Fase 7: Novo Access Token após rotação deve autenticar com sucesso");

      // 11.12 Logout de Sessão (DELETE /session)
      const logoutRes = await request("/session", {
        method: "DELETE",
        body: JSON.stringify({ refreshToken: rotatedRefreshToken }),
        skipAuth: true,
      });
      assert(logoutRes.status === 204, "Fase 7 DELETE /session: Logout de sessão deve responder HTTP 204 No Content");

      // 11.13 Confirmação de revogação: tentar renovar com o token após logout deve falhar
      const postLogoutRefreshRes = await request("/session/refresh", {
        method: "POST",
        body: JSON.stringify({ refreshToken: rotatedRefreshToken }),
        skipAuth: true,
      });
      assert(postLogoutRefreshRes.status === 401, "Fase 7: Refresh token revogado por logout deve falhar com HTTP 401");

      // ---------------------------------------------------------
      // 12. Fase 8: RBAC e Validação de Propriedade
      // ---------------------------------------------------------
      logSection("12. Fase 8: Controle de Acesso Baseado em Papéis (RBAC) e Propriedade");

      // 12.1 Restrição RBAC: Usuário comum tentando listar todos os usuários
      const userListForbiddenRes = await request("/users", {
        method: "GET",
        headers: { Authorization: `Bearer ${userAccessTokenForRbac}` },
        skipAuth: true,
      });
      assert(
        userListForbiddenRes.status === 403,
        "Fase 8 RBAC: GET /users por usuário 'USER' deve responder HTTP 403 Forbidden"
      );
      assert(
        userListForbiddenRes.data?.status === "fail" &&
          userListForbiddenRes.data?.message === "Você não tem permissão para executar esta ação.",
        "Fase 8 RBAC: Resposta 403 de restrictTo deve seguir o formato padronizado"
      );

      // 12.2 Acesso ADMIN: rwieruch (ADMIN) listando usuários
      const adminListRes = await request("/users");
      assert(adminListRes.status === 200, "Fase 8 RBAC: GET /users por ADMIN deve responder HTTP 200 OK");
      const adminListNames = adminListRes.data.map((u) => u.username).sort();
      assert(
        adminListNames.includes("rwieruch") && adminListNames.includes("ddavids"),
        "Fase 8 RBAC: GET /users deve conter os usuários originais do seed"
      );
      const rwieruchUser = adminListRes.data.find((u) => u.username === "rwieruch");
      assert(rwieruchUser?.role === "ADMIN", "Fase 8 RBAC: Usuário seed 'rwieruch' deve possuir role 'ADMIN'");

      // 12.3 Criação de mensagens para testar propriedade
      let adminMessageId = null;
      let userMessageId = null;
      let userOwnDeleteMsgId = null;
      try {
        const adminMsgRes = await request("/messages", {
          method: "POST",
          body: JSON.stringify({ text: `Mensagem do ADMIN [${authTestStamp}]` }),
        });
        assert(adminMsgRes.status === 201, "Fase 8: ADMIN deve criar mensagem com sucesso");
        adminMessageId = adminMsgRes.data.id;
        resourcesToCleanup.messageIds.add(adminMessageId);

        const userMsgRes = await request("/messages", {
          method: "POST",
          headers: { Authorization: `Bearer ${userAccessTokenForRbac}` },
          body: JSON.stringify({ text: `Mensagem do USER [${authTestStamp}]` }),
          skipAuth: true,
        });
        assert(userMsgRes.status === 201, "Fase 8: USER deve criar sua própria mensagem com sucesso");
        userMessageId = userMsgRes.data.id;
        resourcesToCleanup.messageIds.add(userMessageId);

        const userOwnDeleteMsgRes = await request("/messages", {
          method: "POST",
          headers: { Authorization: `Bearer ${userAccessTokenForRbac}` },
          body: JSON.stringify({ text: `Mensagem do USER para auto-exclusão [${authTestStamp}]` }),
          skipAuth: true,
        });
        assert(userOwnDeleteMsgRes.status === 201, "Fase 8: USER deve criar segunda mensagem para testar exclusão própria");
        userOwnDeleteMsgId = userOwnDeleteMsgRes.data.id;
        resourcesToCleanup.messageIds.add(userOwnDeleteMsgId);

        // 12.4 Violação de propriedade: USER tentando alterar/remover mensagem de outro usuário
        const otherMsgPutRes = await request(`/messages/${adminMessageId}`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${userAccessTokenForRbac}` },
          body: JSON.stringify({ text: "Tentativa indevida" }),
          skipAuth: true,
        });
        assert(otherMsgPutRes.status === 403, "Fase 8 isMessageOwner: USER não pode editar mensagem de outro usuário (403)");

        const otherMsgDelRes = await request(`/messages/${adminMessageId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${userAccessTokenForRbac}` },
          skipAuth: true,
        });
        assert(otherMsgDelRes.status === 403, "Fase 8 isMessageOwner: USER não pode remover mensagem de outro usuário (403)");

        // 12.5 Permissão do dono: USER atualizando e excluindo sua própria mensagem
        const ownMsgPutRes = await request(`/messages/${userMessageId}`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${userAccessTokenForRbac}` },
          body: JSON.stringify({ text: "Texto atualizado pelo autor com sucesso" }),
          skipAuth: true,
        });
        assert(ownMsgPutRes.status === 200, "Fase 8 isMessageOwner: Autor pode atualizar própria mensagem (200)");

        const ownMsgDelRes = await request(`/messages/${userOwnDeleteMsgId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${userAccessTokenForRbac}` },
          skipAuth: true,
        });
        assert(ownMsgDelRes.status === 204, "Fase 8 isMessageOwner: Autor pode remover própria mensagem (204)");
        resourcesToCleanup.messageIds.delete(userOwnDeleteMsgId);
        userOwnDeleteMsgId = null;

        // 12.6 Superpoder do Administrador: ADMIN editando e excluindo mensagem de qualquer usuário
        const adminEditUserMsgRes = await request(`/messages/${userMessageId}`, {
          method: "PUT",
          body: JSON.stringify({ text: "Texto moderado pelo ADMIN" }),
        });
        assert(adminEditUserMsgRes.status === 200, "Fase 8 isMessageOwner: ADMIN pode editar mensagem de outro usuário (200)");
        assert(adminEditUserMsgRes.data?.text === "Texto moderado pelo ADMIN", "Fase 8 isMessageOwner: Edição do ADMIN deve persistir novo texto");

        const adminDelUserMsgRes = await request(`/messages/${userMessageId}`, {
          method: "DELETE",
        });
        assert(adminDelUserMsgRes.status === 204, "Fase 8 isMessageOwner: ADMIN pode remover mensagem de outro usuário (204)");
        resourcesToCleanup.messageIds.delete(userMessageId);
        userMessageId = null;

        // 12.7 Bloqueio de escalação de privilégios e proteção de cadastro de terceiros (GET/PUT/DELETE)
        const roleEscalationRes = await request(`/users/${authUserId}`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${userAccessTokenForRbac}` },
          body: JSON.stringify({ role: "ADMIN" }),
          skipAuth: true,
        });
        assert(roleEscalationRes.status === 403, "Fase 8: USER comum tentando alterar próprio role para ADMIN deve receber 403 Forbidden");

        assert(Boolean(rwieruchUser?.id), "Fase 8: ID do usuário ADMIN seed deve estar disponível para testes de propriedade");
        const otherUserGetRes = await request(`/users/${rwieruchUser.id}`, {
          method: "GET",
          headers: { Authorization: `Bearer ${userAccessTokenForRbac}` },
          skipAuth: true,
        });
        assert(otherUserGetRes.status === 403, "Fase 8 isUserOwner: USER não pode consultar cadastro de outro usuário (403)");

        const otherUserPutRes = await request(`/users/${rwieruchUser.id}`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${userAccessTokenForRbac}` },
          body: JSON.stringify({ username: "invasor" }),
          skipAuth: true,
        });
        assert(otherUserPutRes.status === 403, "Fase 8 isUserOwner: USER não pode editar cadastro de outro usuário (403)");

        const otherUserDelRes = await request(`/users/${rwieruchUser.id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${userAccessTokenForRbac}` },
          skipAuth: true,
        });
        assert(otherUserDelRes.status === 403, "Fase 8 isUserOwner: USER não pode remover cadastro de outro usuário (403)");

        // 12.8 Permissão do próprio titular (USER): consulta e edição do próprio cadastro
        const ownUserGetRes = await request(`/users/${authUserId}`, {
          method: "GET",
          headers: { Authorization: `Bearer ${userAccessTokenForRbac}` },
          skipAuth: true,
        });
        assert(ownUserGetRes.status === 200, "Fase 8 isUserOwner: Titular pode consultar o próprio cadastro (200)");
        assert(ownUserGetRes.data?.id === authUserId, "Fase 8 isUserOwner: Consulta própria deve retornar o usuário autenticado");
        assert(ownUserGetRes.data?.password === undefined, "Fase 7 Segurança CWE-200: A senha/hash NUNCA deve ser retornada em consultas");

        const updatedOwnUsername = `${authUsername}_self_edit`;
        const ownUserPutRes = await request(`/users/${authUserId}`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${userAccessTokenForRbac}` },
          body: JSON.stringify({ username: updatedOwnUsername }),
          skipAuth: true,
        });
        assert(ownUserPutRes.status === 200, "Fase 8 isUserOwner: Titular pode editar o próprio cadastro (200)");
        assert(ownUserPutRes.data?.username === updatedOwnUsername, "Fase 8 isUserOwner: Atualização própria deve refletir novo username");

        // 12.9 Permissão do Administrador: ADMIN alterando role de um usuário e revogação transacional (Fase 9)
        const prePromoteRefreshRes = await request("/session/refresh", {
          method: "POST",
          body: JSON.stringify({ refreshToken: emailRefreshToken }),
          skipAuth: true,
        });
        assert(
          prePromoteRefreshRes.status === 200 && Boolean(prePromoteRefreshRes.data?.refreshToken),
          "Fase 9: Refresh token ativo do usuário deve rotacionar antes da alteração de papel"
        );
        const tokenBeforeRoleChange = prePromoteRefreshRes.data.refreshToken;

        const promoteRoleRes = await request(`/users/${authUserId}`, {
          method: "PUT",
          body: JSON.stringify({ role: "ADMIN" }),
        });
        assert(promoteRoleRes.status === 200, "Fase 8 RBAC: ADMIN pode promover role de usuário para ADMIN (200)");
        assert(promoteRoleRes.data?.role === "ADMIN", "Fase 8 RBAC: Role promovido deve ser 'ADMIN'");

        const postPromoteRefreshRes = await request("/session/refresh", {
          method: "POST",
          body: JSON.stringify({ refreshToken: tokenBeforeRoleChange }),
          skipAuth: true,
        });
        assert(
          postPromoteRefreshRes.status === 401,
          "Fase 9 Transação: Alteração efetiva de role deve revogar atomicamente os refresh tokens do usuário (401)"
        );

        const demoteRoleRes = await request(`/users/${authUserId}`, {
          method: "PUT",
          body: JSON.stringify({ role: "USER" }),
        });
        assert(demoteRoleRes.status === 200, "Fase 8 RBAC: ADMIN pode reverter role de usuário para USER (200)");
        assert(demoteRoleRes.data?.role === "USER", "Fase 8 RBAC: Role revertido deve ser 'USER'");

        // 12.10 Permissão do próprio titular (USER): exclusão da própria conta
        const ownUserDelRes = await request(`/users/${authUserId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${userAccessTokenForRbac}` },
          skipAuth: true,
        });
        assert(ownUserDelRes.status === 204, "Fase 8 isUserOwner: Titular pode excluir o próprio cadastro (204)");
        resourcesToCleanup.userIds.delete(authUserId);

        const checkSelfDeletedRes = await request(`/users/${authUserId}`);
        assert(checkSelfDeletedRes.status === 404, "Fase 8: Usuário excluído pelo titular não deve mais existir (404)");
        authUserId = null;
      } finally {
        if (userOwnDeleteMsgId) {
          await request(`/messages/${userOwnDeleteMsgId}`, { method: "DELETE" });
          resourcesToCleanup.messageIds.delete(userOwnDeleteMsgId);
        }
        if (userMessageId) {
          await request(`/messages/${userMessageId}`, { method: "DELETE" });
          resourcesToCleanup.messageIds.delete(userMessageId);
        }
        if (adminMessageId) {
          await request(`/messages/${adminMessageId}`, { method: "DELETE" });
          resourcesToCleanup.messageIds.delete(adminMessageId);
        }
      }
    } finally {
      if (authUserId) {
        await request(`/users/${authUserId}`, { method: "DELETE" });
        resourcesToCleanup.userIds.delete(authUserId);
      }
    }

    // ---------------------------------------------------------
    // 13. Fase 9: Transações Atômicas, Limpeza de Tokens e Seeders
    // ---------------------------------------------------------
    logSection("13. Fase 9: Transações Atômicas, Limpeza de Tokens e Seeders");

    // 13.1 Validação da extração do seeder para src/seeders e desacoplamento de src/index.js
    const seederIndexPath = path.join(projectRoot, "src/seeders/index.js");
    const seederMigrationPath = path.join(
      projectRoot,
      "src/seeders/20261114000001-initial-users-with-messages.js"
    );
    const appIndexPath = path.join(projectRoot, "src/index.js");
    assert(
      fs.existsSync(seederIndexPath) && fs.existsSync(seederMigrationPath),
      "Fase 9 Seeders: Arquivos dedicados em src/seeders/ devem existir"
    );
    const appIndexContent = fs.readFileSync(appIndexPath, "utf8");
    assert(
      appIndexContent.includes('./seeders/index.js'),
      "Fase 9 Seeders: src/index.js deve importar createUsersWithMessages de ./seeders/index.js"
    );
    assert(
      !appIndexContent.includes("const createUsersWithMessages"),
      "Fase 9 Seeders: src/index.js não deve conter definição inline de createUsersWithMessages"
    );

    // 13.2 Rotação atômica concorrente de Refresh Token (sem consumir cota de POST /session)
    assert(
      Boolean(initRefreshToken),
      "Fase 9: Refresh token inicial da sessão de teste deve estar disponível"
    );
    const [concurrentResA, concurrentResB] = await Promise.all([
      request("/session/refresh", {
        method: "POST",
        body: JSON.stringify({ refreshToken: initRefreshToken }),
        skipAuth: true,
      }),
      request("/session/refresh", {
        method: "POST",
        body: JSON.stringify({ refreshToken: initRefreshToken }),
        skipAuth: true,
      }),
    ]);
    const concurrentStatuses = [concurrentResA.status, concurrentResB.status].sort((a, b) => a - b);
    assert(
      concurrentStatuses[0] === 200 && concurrentStatuses[1] === 401,
      "Fase 9 Transação Atômica: Corrida concorrente em POST /session/refresh deve permitir apenas 1 rotação (200) e rejeitar a outra (401)",
      concurrentStatuses
    );
    const winnerRes = concurrentResA.status === 200 ? concurrentResA : concurrentResB;
    const winnerRefreshToken = winnerRes.data?.refreshToken;
    assert(
      Boolean(winnerRefreshToken) && winnerRefreshToken !== initRefreshToken,
      "Fase 9 Transação Atômica: Rotação vencedora deve emitir novo refresh token distinto"
    );

    // Revoga o token de sessão de rwieruch para manter banco limpo
    const cleanupInitSessionRes = await request("/session", {
      method: "DELETE",
      body: JSON.stringify({ refreshToken: winnerRefreshToken }),
      skipAuth: true,
    });
    assert(
      cleanupInitSessionRes.status === 204,
      "Fase 9 Cleanup: Logout do refresh token inicial deve responder 204 No Content"
    );

    // 13.3 Validação E2E do comando npm run db:clean-tokens
    const cleanMarker = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const expiredTokenPlain = `expired_e2e_${cleanMarker}`;
    const validTokenPlain = `valid_e2e_${cleanMarker}`;
    let dbCleanupPrepared = false;

    try {
      const insertTokensScript = `
        import "dotenv/config";
        import crypto from "crypto";
        import models, { sequelize } from "./src/models/index.js";
        const hash = (t) => crypto.createHash("sha256").update(t).digest("hex");
        try {
          const user = await models.User.findOne({ where: { username: "rwieruch" } });
          if (!user) throw new Error("Usuário rwieruch não encontrado");
          await models.RefreshToken.create({
            token: hash(${JSON.stringify(expiredTokenPlain)}),
            expiresAt: new Date(Date.now() - 3600000),
            userId: user.id,
          });
          await models.RefreshToken.create({
            token: hash(${JSON.stringify(validTokenPlain)}),
            expiresAt: new Date(Date.now() + 3600000),
            userId: user.id,
          });
          console.log("INSERTED_OK");
        } finally {
          await sequelize.close();
        }
      `;

      const insertRes = spawnSync(
        "node",
        ["--input-type=module", "-e", insertTokensScript],
        { cwd: projectRoot, encoding: "utf8" }
      );
      assert(
        insertRes.status === 0 && insertRes.stdout.includes("INSERTED_OK"),
        "Fase 9 db:clean-tokens: Preparação de tokens expirado e válido no banco deve ter sucesso",
        insertRes.stderr || insertRes.stdout
      );
      dbCleanupPrepared = true;

      const cleanCmdRes = spawnSync("npm", ["run", "db:clean-tokens"], {
        cwd: projectRoot,
        encoding: "utf8",
      });
      assert(
        cleanCmdRes.status === 0,
        "Fase 9 db:clean-tokens: Comando 'npm run db:clean-tokens' deve finalizar com exit code 0",
        cleanCmdRes.stderr || cleanCmdRes.stdout
      );
      assert(
        cleanCmdRes.stdout.includes("[tokenCleanup]"),
        "Fase 9 db:clean-tokens: Saída deve registrar log informativo do utilitário",
        cleanCmdRes.stdout
      );

      const verifyTokensScript = `
        import "dotenv/config";
        import crypto from "crypto";
        import models, { sequelize } from "./src/models/index.js";
        const hash = (t) => crypto.createHash("sha256").update(t).digest("hex");
        try {
          const expired = await models.RefreshToken.findOne({
            where: { token: hash(${JSON.stringify(expiredTokenPlain)}) },
          });
          const valid = await models.RefreshToken.findOne({
            where: { token: hash(${JSON.stringify(validTokenPlain)}) },
          });
          console.log(JSON.stringify({ expiredExists: Boolean(expired), validExists: Boolean(valid) }));
        } finally {
          await sequelize.close();
        }
      `;

      const verifyRes = spawnSync(
        "node",
        ["--input-type=module", "-e", verifyTokensScript],
        { cwd: projectRoot, encoding: "utf8" }
      );
      let verifyData = {};
      try {
        const lastLine = verifyRes.stdout.trim().split("\n").pop();
        verifyData = JSON.parse(lastLine);
      } catch {}
      assert(
        verifyRes.status === 0 &&
          verifyData.expiredExists === false &&
          verifyData.validExists === true,
        "Fase 9 db:clean-tokens: Deve excluir o token expirado e preservar intacto o token válido",
        { stdout: verifyRes.stdout, stderr: verifyRes.stderr, verifyData }
      );
    } finally {
      if (dbCleanupPrepared) {
        const removeTestTokensScript = `
          import "dotenv/config";
          import crypto from "crypto";
          import { Op } from "sequelize";
          import models, { sequelize } from "./src/models/index.js";
          const hash = (t) => crypto.createHash("sha256").update(t).digest("hex");
          try {
            await models.RefreshToken.destroy({
              where: {
                token: {
                  [Op.in]: [
                    hash(${JSON.stringify(expiredTokenPlain)}),
                    hash(${JSON.stringify(validTokenPlain)}),
                  ],
                },
              },
            });
          } finally {
            await sequelize.close();
          }
        `;
        spawnSync(
          "node",
          ["--input-type=module", "-e", removeTestTokensScript],
          { cwd: projectRoot, encoding: "utf8" }
        );
      }
    }

    // ---------------------------------------------------------
    // 14. Fase 10: Swagger/OpenAPI, Paginação/Ordenação e Hardening de Payload
    // ---------------------------------------------------------
    logSection("14. Fase 10: Swagger/OpenAPI, Paginação/Ordenação e Hardening 10kb");

    // 14.1 Documentação pública /api-docs.json e /api-docs
    const openApiJsonRes = await request("/api-docs.json", {
      method: "GET",
      skipAuth: true,
    });
    assert(openApiJsonRes.status === 200, "Fase 10 Swagger: GET /api-docs.json deve ser público e retornar HTTP 200");
    assert(
      openApiJsonRes.data?.openapi === "3.0.3" &&
        Boolean(openApiJsonRes.data?.paths?.["/users"]) &&
        Boolean(openApiJsonRes.data?.components?.securitySchemes?.bearerAuth),
      "Fase 10 Swagger: Especificação OpenAPI deve estar na versão 3.0.3 com paths e bearerAuth"
    );

    const swaggerUiRes = await request("/api-docs", {
      method: "GET",
      skipAuth: true,
    });
    assert(swaggerUiRes.status === 200, "Fase 10 Swagger: GET /api-docs deve ser público e retornar HTTP 200");
    assert(
      (swaggerUiRes.headers.get("content-type") || "").includes("text/html") &&
        (swaggerUiRes.headers.get("content-security-policy") || "").includes("https://unpkg.com") &&
        (swaggerUiRes.headers.get("content-security-policy") || "").includes("object-src 'none'") &&
        typeof swaggerUiRes.data === "string" &&
        swaggerUiRes.data.includes("SwaggerUIBundle") &&
        swaggerUiRes.data.includes("/api-docs.json"),
      "Fase 10 Swagger: GET /api-docs deve servir HTML do Swagger UI com CSP liberando unpkg e diretivas restritivas"
    );

    const swaggerHeadRes = await request("/api-docs", {
      method: "HEAD",
      skipAuth: true,
    });
    assert(swaggerHeadRes.status === 200, "Fase 10 Swagger: HEAD /api-docs deve ser público e retornar HTTP 200");

    // 14.2 Paginação e ordenação determinística em GET /messages e GET /users + CORS exposedHeaders
    const paginatedMsgRes = await request("/messages?page=1&limit=1&order=ASC", {
      method: "GET",
      headers: { Origin: "http://localhost:3000" },
    });
    assert(paginatedMsgRes.status === 200, "Fase 10 Paginação: GET /messages?page=1&limit=1&order=ASC deve retornar 200");
    assert(
      Array.isArray(paginatedMsgRes.data) && paginatedMsgRes.data.length === 1,
      "Fase 10 Paginação: GET /messages com limit=1 deve retornar exatamente 1 item"
    );
    assert(
      paginatedMsgRes.headers.get("x-total-count") === "3" &&
        paginatedMsgRes.headers.get("x-page") === "1" &&
        paginatedMsgRes.headers.get("x-limit") === "1" &&
        paginatedMsgRes.headers.get("x-total-pages") === "3",
      "Fase 10 Paginação: Cabeçalhos X-Total-Count, X-Page, X-Limit e X-Total-Pages devem refletir os metadados de /messages"
    );
    const exposedHeaders = paginatedMsgRes.headers.get("access-control-expose-headers") || "";
    assert(
      exposedHeaders.includes("X-Total-Count") && exposedHeaders.includes("X-Total-Pages"),
      "Fase 10 CORS: Access-Control-Expose-Headers deve expor os cabeçalhos de paginação"
    );

    const msgAscRes = await request("/messages?page=1&limit=10&order=ASC", { method: "GET" });
    const msgDescRes = await request("/messages?page=1&limit=10&order=DESC", { method: "GET" });
    const ascIds = Array.isArray(msgAscRes.data) ? msgAscRes.data.map((m) => m.id) : [];
    const descIds = Array.isArray(msgDescRes.data) ? msgDescRes.data.map((m) => m.id) : [];
    assert(
      msgAscRes.status === 200 &&
        msgDescRes.status === 200 &&
        ascIds.length === 3 &&
        ascIds.slice().reverse().join(",") === descIds.join(","),
      "Fase 10 Ordenação: GET /messages com order=ASC e order=DESC deve retornar ordenação determinística invertida"
    );

    const paginatedUsersRes = await request("/users?page=1&limit=1&order=ASC", { method: "GET" });
    assert(paginatedUsersRes.status === 200, "Fase 10 Paginação: GET /users?page=1&limit=1&order=ASC deve retornar 200");
    assert(
      Array.isArray(paginatedUsersRes.data) &&
        paginatedUsersRes.data.length === 1 &&
        paginatedUsersRes.headers.get("x-total-count") === "2" &&
        paginatedUsersRes.headers.get("x-page") === "1" &&
        paginatedUsersRes.headers.get("x-limit") === "1" &&
        paginatedUsersRes.headers.get("x-total-pages") === "2",
      "Fase 10 Paginação: GET /users paginado deve retornar 1 usuário e cabeçalhos X-* corretos"
    );

    const invalidPaginationRes = await request("/messages?page=0&limit=101", { method: "GET" });
    assert(
      invalidPaginationRes.status === 400 &&
        invalidPaginationRes.data?.status === "fail" &&
        Array.isArray(invalidPaginationRes.data?.errors) &&
        invalidPaginationRes.data.errors.some((e) => e.includes("query.page")) &&
        invalidPaginationRes.data.errors.some((e) => e.includes("query.limit")),
      "Fase 10 Paginação: Parâmetros inválidos (page=0&limit=101) devem falhar com HTTP 400 e erros Zod"
    );

    const overflowPageRes = await request("/messages?page=999999999", { method: "GET" });
    assert(
      overflowPageRes.status === 400 &&
        overflowPageRes.data?.status === "fail" &&
        Array.isArray(overflowPageRes.data?.errors) &&
        overflowPageRes.data.errors.some((e) => e.includes("query.page")),
      "Fase 10 Paginação: Página acima do limite máximo (page=999999999) deve falhar com HTTP 400"
    );

    // 14.3 Hardening de payload (JSON malformado -> 400 e payload > 10kb -> 413)
    const malformedJsonRes = await request("/messages", {
      method: "POST",
      body: '{"text": ',
    });
    assert(
      malformedJsonRes.status === 400 &&
        malformedJsonRes.data?.status === "fail" &&
        malformedJsonRes.data?.message === "JSON malformado no corpo da requisição.",
      "Fase 10 Hardening: JSON malformado no corpo deve retornar HTTP 400 padronizado"
    );

    const oversizedPayloadRes = await request("/messages", {
      method: "POST",
      body: JSON.stringify({ text: "x".repeat(12000) }),
    });
    assert(
      oversizedPayloadRes.status === 413 &&
        oversizedPayloadRes.data?.status === "fail" &&
        oversizedPayloadRes.data?.message === "Payload da requisição excede o limite máximo permitido (10kb).",
      "Fase 10 Hardening: Payload JSON acima de 10kb deve retornar HTTP 413 Payload Too Large"
    );

    // 14.4 Alinhamento Zod/PostgreSQL (B1: mensagem de 500 chars e username <= 255) e prevenção de identidade (S6: '@' no username)
    let longMessageId = null;
    try {
      const longText = "a".repeat(500);
      const longMsgRes = await request("/messages", {
        method: "POST",
        body: JSON.stringify({ text: longText }),
      });
      assert(longMsgRes.status === 201, "Fase 10 B1: Mensagem de 500 caracteres deve ser aceita com HTTP 201 Created");
      assert(longMsgRes.data?.id && longMsgRes.data?.text === longText, "Fase 10 B1: Mensagem de 500 caracteres deve ser persistida integralmente");
      if (longMsgRes.data?.id) {
        longMessageId = longMsgRes.data.id;
        resourcesToCleanup.messageIds.add(longMessageId);
      }
    } finally {
      if (longMessageId) {
        const delLongMsgRes = await request(`/messages/${longMessageId}`, { method: "DELETE" });
        if (delLongMsgRes.status === 204) {
          resourcesToCleanup.messageIds.delete(longMessageId);
        }
      }
    }

    const usernameWithAtRes = await request("/users", {
      method: "POST",
      body: JSON.stringify({
        username: `user_at_${Date.now()}@evil`,
        email: `valid_${Date.now()}@unicap.br`,
        password: "TestPassword123!",
      }),
      skipAuth: true,
    });
    assert(
      usernameWithAtRes.status === 400 &&
        usernameWithAtRes.data?.status === "fail" &&
        Array.isArray(usernameWithAtRes.data?.errors) &&
        usernameWithAtRes.data.errors.some((e) => e.includes("Username não pode conter o caractere '@'")),
      "Fase 10 S6: POST /users com '@' no username deve falhar com HTTP 400"
    );

    const longUsernameRes = await request("/users", {
      method: "POST",
      body: JSON.stringify({
        username: "u".repeat(256),
        email: `longuser_${Date.now()}@unicap.br`,
        password: "TestPassword123!",
      }),
      skipAuth: true,
    });
    assert(
      longUsernameRes.status === 400 &&
        longUsernameRes.data?.status === "fail" &&
        Array.isArray(longUsernameRes.data?.errors) &&
        longUsernameRes.data.errors.some((e) => e.includes("Username deve ter no máximo 255 caracteres")),
      "Fase 10 B1: POST /users com username de 256 caracteres deve falhar com HTTP 400"
    );

    // ---------------------------------------------------------
    // 15. Teste de Bloqueio por Limite de Taxa (Rate Limit 429 no Login) e Integração com CORS
    // ---------------------------------------------------------
    logSection("15. Teste de Bloqueio por Limite de Taxa (Rate Limit 429 em POST /session) e CORS");

    // Como o authLimiterMiddleware (5 req/15min) é aplicado exclusivamente a POST /session,
    // executamos este teste ao final da suíte para não esgotar a cota antes dos testes de login.
    let blockedResponse = null;
    for (let i = 0; i < 6; i++) {
      const res = await request("/session", {
        method: "POST",
        body: JSON.stringify({ login: "rwieruch", password: ADMIN_PASSWORD }),
        skipAuth: true,
      });
      if (res.status === 429) {
        blockedResponse = res;
        break;
      }
    }
    assert(
      blockedResponse !== null && blockedResponse.status === 429,
      "RateLimit POST /session: Ao exceder 5 requisições deve bloquear com HTTP 429 Too Many Requests"
    );
    assert(
      blockedResponse.data && blockedResponse.data.status === "fail",
      "RateLimit POST /session: Resposta 429 deve possuir 'status: fail' formatado pelo errorMiddleware"
    );
    assert(
      blockedResponse.data?.message === "Muitas tentativas de autenticação originadas deste IP. Tente novamente em 15 minutos.",
      "RateLimit POST /session: Mensagem de 429 deve corresponder exatamente à configurada em authLimiterMiddleware"
    );
    assert(
      blockedResponse.headers.has("retry-after") && Number(blockedResponse.headers.get("retry-after")) > 0,
      "RateLimit POST /session: Resposta 429 deve conter cabeçalho 'Retry-After' com valor numérico positivo"
    );
    assert(
      blockedResponse.headers.get("x-ratelimit-remaining") === "0",
      "RateLimit POST /session: Cabeçalho 'X-RateLimit-Remaining' deve ser '0' na resposta bloqueada"
    );

    // 13.2 Preservação de cabeçalhos CORS em erro 429 (Origem Autorizada)
    const blockedCorsAllowedRes = await request("/session", {
      method: "POST",
      headers: { Origin: "http://localhost:3000" },
      body: JSON.stringify({ login: "rwieruch", password: ADMIN_PASSWORD }),
      skipAuth: true,
    });
    assert(
      blockedCorsAllowedRes.status === 429,
      "RateLimit CORS: Requisição sob origem autorizada continua bloqueada com HTTP 429"
    );
    assert(
      blockedCorsAllowedRes.headers.get("access-control-allow-origin") === "http://localhost:3000",
      "RateLimit CORS: Resposta 429 DEVE preservar 'Access-Control-Allow-Origin' para clientes web autorizados"
    );
    assert(
      blockedCorsAllowedRes.headers.get("access-control-allow-credentials") === "true",
      "RateLimit CORS: Resposta 429 DEVE preservar 'Access-Control-Allow-Credentials: true'"
    );

    // 13.3 Precedência do CORS sobre Rate Limit para Origens Não Autorizadas
    const blockedCorsDisallowedRes = await request("/session", {
      method: "POST",
      headers: { Origin: "http://site-malicioso.com" },
      body: JSON.stringify({ login: "rwieruch", password: ADMIN_PASSWORD }),
      skipAuth: true,
    });
    assert(
      blockedCorsDisallowedRes.status === 403,
      "RateLimit CORS: Origem não autorizada deve ser barrada pelo CORS com 403 Forbidden antes do processamento"
    );
    assert(
      !blockedCorsDisallowedRes.headers.has("access-control-allow-origin"),
      "RateLimit CORS: Resposta 403 de origem não autorizada NÃO deve receber 'Access-Control-Allow-Origin'"
    );

    // Resumo final
    logSection("Resultado Final da Execução");
    console.log(`${colors.green}${colors.bold}Total de asserções executadas:${colors.reset} ${totalTests}`);
    console.log(`${colors.green}${colors.bold}Sucessos:${colors.reset} ${passedTests}`);
    console.log(`${colors.red}${colors.bold}Falhas:${colors.reset} ${failedTests}`);
    console.log(`${colors.cyan}${colors.bold}Requisições HTTP enviadas na suíte:${colors.reset} ${totalHttpRequests}`);
    console.log(`\n${colors.green}${colors.bold}✓ O banco de dados de produção está limpo: todas as entidades temporárias foram removidas com sucesso.${colors.reset}\n`);
  } catch (error) {
    console.error(`\n${colors.red}${colors.bold}Interrupção por erro durante os testes:${colors.reset}`, error.message);
    await cleanupAll();
    process.exit(1);
  }
}

runTestSuite();
