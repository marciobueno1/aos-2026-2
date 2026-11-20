import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecretpassword123";
process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgres://dummy:dummy@localhost:5432/dummy_db";

import errorMiddleware from "../src/middlewares/error.js";
import validate from "../src/middlewares/validate.js";
import {
  corsMiddleware,
  protectRoutes,
  paginationQuerySchema,
} from "../src/middlewares/index.js";
import userController from "../src/controllers/userController.js";
import messageController from "../src/controllers/messageController.js";
import { userService, messageService } from "../src/services/index.js";
import models, { sequelize } from "../src/models/index.js";
import { MAX_PAGE, normalizePaginationParams } from "../src/utils/index.js";
import { createUsersWithMessages, runSeeders } from "../src/seeders/index.js";
import {
  resolveSeedPassword,
  buildInitialUsers,
} from "../src/seeders/20261114000001-initial-users-with-messages.js";
import { openapiSpec, getSwaggerUiHtml } from "../src/docs/openapi.js";
import { docs as docsRouter } from "../src/routes/index.js";

const createMockRes = () => {
  const headers = {};
  return {
    statusCode: null,
    body: undefined,
    contentType: null,
    headers,
    set(name, value) {
      headers[name.toLowerCase()] = value;
      return this;
    },
    setHeader(name, value) {
      headers[name.toLowerCase()] = value;
      return this;
    },
    getHeader(name) {
      return headers[name.toLowerCase()];
    },
    type(mime) {
      this.contentType = mime;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
};

// -------------------------------------------------------------
// 1. Hardening de Payload (413) e JSON Malformado (400)
// -------------------------------------------------------------
test("Fase 10 - errorMiddleware: trata payload acima de 10kb (entity.too.large) com HTTP 413", () => {
  const errByType = new Error("request entity too large");
  errByType.type = "entity.too.large";

  const res1 = createMockRes();
  errorMiddleware(errByType, {}, res1, () => {});
  assert.equal(res1.statusCode, 413);
  assert.equal(res1.body.status, "fail");
  assert.equal(
    res1.body.message,
    "Payload da requisição excede o limite máximo permitido (10kb)."
  );

  const errByStatus = new Error("Payload Too Large");
  errByStatus.status = 413;
  const res2 = createMockRes();
  errorMiddleware(errByStatus, {}, res2, () => {});
  assert.equal(res2.statusCode, 413);
  assert.equal(res2.body.status, "fail");

  const errByStatusCode = new Error("Payload Too Large");
  errByStatusCode.statusCode = 413;
  const res3 = createMockRes();
  errorMiddleware(errByStatusCode, {}, res3, () => {});
  assert.equal(res3.statusCode, 413);
});

test("Fase 10 - errorMiddleware: trata SyntaxError de JSON malformado no body com HTTP 400", () => {
  const syntaxErr = new SyntaxError("Unexpected token } in JSON at position 10");
  syntaxErr.status = 400;
  syntaxErr.body = '{"text": }';

  const res = createMockRes();
  errorMiddleware(syntaxErr, {}, res, () => {});
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.status, "fail");
  assert.equal(res.body.message, "JSON malformado no corpo da requisição.");

  const syntaxErrStatusCode = new SyntaxError("Bad JSON");
  syntaxErrStatusCode.statusCode = 400;
  syntaxErrStatusCode.body = "{";
  const res2 = createMockRes();
  errorMiddleware(syntaxErrStatusCode, {}, res2, () => {});
  assert.equal(res2.statusCode, 400);

  // SyntaxError interno sem propriedade body não deve ser mascarado como 400
  const internalSyntaxErr = new SyntaxError("Erro interno de sintaxe");
  const res3 = createMockRes();
  errorMiddleware(internalSyntaxErr, {}, res3, () => {});
  assert.equal(res3.statusCode, 500);
});

test("Fase 10 - src/index.js configura parsers com limite de 10kb e registra routes.docs", async () => {
  const indexPath = path.resolve(process.cwd(), "src/index.js");
  const source = await fs.readFile(indexPath, "utf8");

  assert.ok(source.includes('express.json({ limit: "10kb" })'));
  assert.ok(source.includes('express.urlencoded({ extended: true, limit: "10kb" })'));
  assert.ok(source.includes('app.use("/", routes.docs)'));
});

// -------------------------------------------------------------
// 2. Paginação, Ordenação, Validate (Express 5) e CORS
// -------------------------------------------------------------
test("Fase 10 - validate: sobrescreve req.query definido como getter read-only (padrão Express 5)", async () => {
  const middleware = validate(paginationQuerySchema);
  const proto = {};
  Object.defineProperty(proto, "query", {
    get() {
      return { page: "2", limit: "15", order: "asc" };
    },
    configurable: true,
    enumerable: true,
  });

  const req = Object.create(proto);
  req.body = undefined;
  req.params = {};

  let nextErr = "not-called";
  await middleware(req, {}, (err) => {
    nextErr = err;
  });

  assert.equal(nextErr, undefined);
  assert.deepEqual(req.query, { page: 2, limit: 15, order: "ASC" });
});

test("Fase 10 - paginationQuerySchema: aplica defaults, coerção e rejeita valores inválidos", () => {
  const defaults = paginationQuerySchema.safeParse({ query: {} });
  assert.equal(defaults.success, true);
  assert.deepEqual(defaults.data.query, { page: 1, limit: 10, order: "DESC" });

  const coerced = paginationQuerySchema.safeParse({
    query: { page: "3", limit: "50", order: "asc" },
  });
  assert.equal(coerced.success, true);
  assert.deepEqual(coerced.data.query, { page: 3, limit: 50, order: "ASC" });

  assert.equal(
    paginationQuerySchema.safeParse({ query: { page: "0" } }).success,
    false
  );
  assert.equal(
    paginationQuerySchema.safeParse({ query: { page: "1.5" } }).success,
    false
  );
  assert.equal(
    paginationQuerySchema.safeParse({ query: { page: "1000001" } }).success,
    false
  );
  assert.equal(
    paginationQuerySchema.safeParse({ query: { page: String(MAX_PAGE) } }).success,
    true
  );
  assert.equal(
    paginationQuerySchema.safeParse({ query: { limit: "0" } }).success,
    false
  );
  assert.equal(
    paginationQuerySchema.safeParse({ query: { limit: "101" } }).success,
    false
  );
  assert.equal(
    paginationQuerySchema.safeParse({ query: { order: "RANDOM" } }).success,
    false
  );
});

test("Fase 10 - normalizePaginationParams e serviços getAllUsers/getAllMessages: paginação determinística e defesa em profundidade", async () => {
  assert.deepEqual(normalizePaginationParams(), {
    page: 1,
    limit: 10,
    order: "DESC",
    offset: 0,
  });
  assert.deepEqual(
    normalizePaginationParams({ page: -4, limit: 500, order: "INVALID" }),
    { page: 1, limit: 100, order: "DESC", offset: 0 }
  );
  assert.deepEqual(
    normalizePaginationParams({ page: "abc", limit: "xyz", order: "asc" }),
    { page: 1, limit: 10, order: "ASC", offset: 0 }
  );
  assert.deepEqual(
    normalizePaginationParams({ page: 1e25, limit: 10, order: "DESC" }),
    {
      page: MAX_PAGE,
      limit: 10,
      order: "DESC",
      offset: (MAX_PAGE - 1) * 10,
    }
  );

  const originalUserFindAndCountAll = models.User.findAndCountAll;
  const originalMsgFindAndCountAll = models.Message.findAndCountAll;
  let capturedUserQuery = null;
  let capturedMsgQuery = null;

  models.User.findAndCountAll = async (opts) => {
    capturedUserQuery = opts;
    return { rows: [{ id: "u-1" }], count: 15 };
  };
  models.Message.findAndCountAll = async (opts) => {
    capturedMsgQuery = opts;
    return { rows: [], count: 0 };
  };

  try {
    const userResult = await userService.getAllUsers({
      page: 2,
      limit: 5,
      order: "ASC",
    });
    assert.deepEqual(capturedUserQuery, {
      order: [
        ["createdAt", "ASC"],
        ["id", "ASC"],
      ],
      limit: 5,
      offset: 5,
    });
    assert.deepEqual(userResult, {
      data: [{ id: "u-1" }],
      meta: { total: 15, page: 2, limit: 5, totalPages: 3, order: "ASC" },
    });

    const msgResult = await messageService.getAllMessages();
    assert.deepEqual(capturedMsgQuery, {
      order: [
        ["createdAt", "DESC"],
        ["id", "DESC"],
      ],
      limit: 10,
      offset: 0,
    });
    assert.deepEqual(msgResult, {
      data: [],
      meta: { total: 0, page: 1, limit: 10, totalPages: 1, order: "DESC" },
    });
  } finally {
    models.User.findAndCountAll = originalUserFindAndCountAll;
    models.Message.findAndCountAll = originalMsgFindAndCountAll;
  }
});

test("Fase 10 - controllers getUsers/getMessages: definem headers X-Total-Count, X-Page, X-Limit, X-Total-Pages e retornam array", async () => {
  const originalGetAllUsers = userService.getAllUsers;
  const originalGetAllMessages = messageService.getAllMessages;

  let userServiceArgs = null;
  let msgServiceArgs = null;
  const fakeUsers = [{ id: "u-1", username: "alice" }];
  const fakeMessages = [{ id: "m-1", text: "Olá" }];

  userService.getAllUsers = async (args) => {
    userServiceArgs = args;
    return {
      data: fakeUsers,
      meta: { total: 21, page: 2, limit: 5, totalPages: 5, order: "ASC" },
    };
  };
  messageService.getAllMessages = async (args) => {
    msgServiceArgs = args;
    return {
      data: fakeMessages,
      meta: { total: 3, page: 1, limit: 10, totalPages: 1, order: "DESC" },
    };
  };

  try {
    const resUsers = createMockRes();
    await userController.getUsers(
      { query: { page: 2, limit: 5, order: "ASC" } },
      resUsers
    );
    assert.deepEqual(userServiceArgs, { page: 2, limit: 5, order: "ASC" });
    assert.equal(resUsers.statusCode, 200);
    assert.deepEqual(resUsers.body, fakeUsers);
    assert.equal(resUsers.headers["x-total-count"], "21");
    assert.equal(resUsers.headers["x-page"], "2");
    assert.equal(resUsers.headers["x-limit"], "5");
    assert.equal(resUsers.headers["x-total-pages"], "5");

    const resMessages = createMockRes();
    await messageController.getMessages({}, resMessages);
    assert.deepEqual(msgServiceArgs, { page: 1, limit: 10, order: "DESC" });
    assert.equal(resMessages.statusCode, 200);
    assert.deepEqual(resMessages.body, fakeMessages);
    assert.equal(resMessages.headers["x-total-count"], "3");
    assert.equal(resMessages.headers["x-page"], "1");
    assert.equal(resMessages.headers["x-limit"], "10");
    assert.equal(resMessages.headers["x-total-pages"], "1");
  } finally {
    userService.getAllUsers = originalGetAllUsers;
    messageService.getAllMessages = originalGetAllMessages;
  }
});

test("Fase 10 - corsMiddleware: expõe cabeçalhos de paginação via Access-Control-Expose-Headers", (t, done) => {
  const req = {
    headers: { origin: "http://localhost:3000" },
    method: "GET",
    url: "/messages",
  };
  const res = createMockRes();

  corsMiddleware(req, res, (err) => {
    assert.equal(err, undefined);
    assert.equal(
      res.getHeader("access-control-expose-headers"),
      "X-Total-Count,X-Page,X-Limit,X-Total-Pages"
    );
    done();
  });
});

// -------------------------------------------------------------
// 3. OpenAPI 3.0.3 / Swagger UI e Rotas Públicas
// -------------------------------------------------------------
test("Fase 10 - protectRoutes: libera GET e HEAD para /api-docs e /api-docs.json sem autenticação", () => {
  for (const method of ["GET", "HEAD"]) {
    for (const docPath of ["/api-docs", "/api-docs.json"]) {
      const req = { method, path: docPath, baseUrl: "", context: { me: null } };
      let capturedErr;
      let nextCalled = false;
      protectRoutes(req, {}, (err) => {
        nextCalled = true;
        capturedErr = err;
      });
      assert.equal(nextCalled, true);
      assert.equal(capturedErr, undefined);
    }
  }
});

test("Fase 10 - openapiSpec e getSwaggerUiHtml: especificação OpenAPI 3.0.3 completa e HTML válido", () => {
  assert.equal(openapiSpec.openapi, "3.0.3");
  assert.equal(openapiSpec.components.securitySchemes.bearerAuth.type, "http");
  assert.equal(openapiSpec.components.securitySchemes.bearerAuth.scheme, "bearer");

  const expectedSchemas = [
    "User",
    "CreateUserInput",
    "UpdateUserInput",
    "Message",
    "MessageInput",
    "LoginInput",
    "RefreshTokenInput",
    "SessionResponse",
    "ErrorResponse",
  ];
  for (const schemaName of expectedSchemas) {
    assert.ok(openapiSpec.components.schemas[schemaName], `Schema ${schemaName} ausente`);
  }

  const expectedPaths = [
    "/",
    "/api-docs",
    "/api-docs.json",
    "/session",
    "/session/refresh",
    "/users",
    "/users/{userId}",
    "/messages",
    "/messages/{messageId}",
  ];
  for (const apiPath of expectedPaths) {
    assert.ok(openapiSpec.paths[apiPath], `Path ${apiPath} ausente`);
  }

  assert.ok(openapiSpec.paths["/users"].get.responses[200].headers["X-Total-Count"]);
  assert.ok(openapiSpec.paths["/messages"].get.responses[200].headers["X-Total-Pages"]);
  assert.ok(openapiSpec.paths["/messages"].post.responses[413]);
  assert.ok(openapiSpec.paths["/session"].post.responses[429]);

  const html = getSwaggerUiHtml("/custom-docs.json");
  assert.ok(html.includes("swagger-ui-dist@5"));
  assert.ok(html.includes('id="swagger-ui"'));
  assert.ok(html.includes('"/custom-docs.json"'));

  const maliciousHtml = getSwaggerUiHtml('</script><script>alert(1)</script>');
  assert.equal(maliciousHtml.includes("</script><script>"), false);
  assert.ok(maliciousHtml.includes("\\u003c/script>"));
});

test("Fase 10 - routes.docs: serve /api-docs.json e /api-docs com CSP adequado para Swagger UI", async () => {
  const invokeRoute = async (routePath) => {
    const req = { method: "GET", url: routePath, path: routePath };
    const res = createMockRes();
    await new Promise((resolve, reject) => {
      docsRouter.handle(req, res, (err) => (err ? reject(err) : resolve()));
      setImmediate(resolve);
    });
    return res;
  };

  const jsonRes = await invokeRoute("/api-docs.json");
  assert.equal(jsonRes.statusCode, 200);
  assert.equal(jsonRes.body, openapiSpec);

  const htmlRes = await invokeRoute("/api-docs");
  assert.equal(htmlRes.statusCode, 200);
  assert.equal(htmlRes.contentType, "html");
  const csp = htmlRes.headers["content-security-policy"];
  assert.ok(csp.includes("https://unpkg.com"));
  assert.ok(csp.includes("object-src 'none'"));
  assert.ok(csp.includes("base-uri 'self'"));
  assert.ok(csp.includes("frame-ancestors 'self'"));
  assert.ok(htmlRes.body.includes("SwaggerUIBundle"));
});

// -------------------------------------------------------------
// 4. Utilitário CLI runSeeders
// -------------------------------------------------------------
test("Fase 10 - runSeeders: executa seeders com log, erro com exitCode = 1 e fechamento condicional da conexão", async () => {
  const originalCreate = models.User.create;
  const originalTransaction = sequelize.transaction;
  const originalClose = sequelize.close;
  const originalExitCode = process.exitCode;

  let closeCalls = 0;
  const logs = [];
  const errors = [];
  const mockLogger = {
    log: (...args) => logs.push(args.join(" ")),
    error: (...args) => errors.push(args.join(" ")),
  };

  sequelize.transaction = async (callback) => await callback({ id: "tx-run-seed" });
  models.User.create = async (data) => data;
  sequelize.close = async () => {
    closeCalls += 1;
  };

  try {
    const created = await runSeeders({ logger: mockLogger });
    assert.equal(created.length, 2);
    assert.equal(closeCalls, 1);
    assert.equal(errors.length, 0);
    assert.ok(logs[0].includes("2 usuário(s)"));

    await runSeeders({ closeConnection: false, logger: mockLogger });
    assert.equal(closeCalls, 1);

    models.User.create = async () => {
      throw new Error("Erro simulado no seed");
    };
    process.exitCode = undefined;
    const failed = await runSeeders({ closeConnection: true, logger: mockLogger });
    assert.equal(failed, undefined);
    assert.equal(process.exitCode, 1);
    assert.equal(closeCalls, 2);
    assert.equal(errors.length, 1);
  } finally {
    models.User.create = originalCreate;
    sequelize.transaction = originalTransaction;
    sequelize.close = originalClose;
    process.exitCode = originalExitCode;
  }
});

test("Fase 10 - src/seeders/index.js: importa dotenv/config no topo e carrega DATABASE_URL sem cair em dummy_db", async () => {
  const seedersIndexPath = path.resolve(process.cwd(), "src/seeders/index.js");
  const source = await fs.readFile(seedersIndexPath, "utf8");
  const lines = source.split(/\r?\n/);
  assert.equal(lines[0].trim(), 'import "dotenv/config";');
  assert.ok(
    source.indexOf('import "dotenv/config"') < source.indexOf("../models/index.js")
  );

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "express01-seed-env-"));
  const tempEnvPath = path.join(tempDir, ".env");
  await fs.writeFile(
    tempEnvPath,
    "DATABASE_URL=postgres://seeduser:seedpass@seed-db.internal:5432/seed_real_db\n",
    "utf8"
  );

  try {
    const childEnv = { ...process.env, NODE_ENV: "development", DOTENV_CONFIG_PATH: tempEnvPath };
    delete childEnv.DATABASE_URL;

    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        'import "./src/seeders/index.js"; const { sequelize } = await import("./src/models/index.js"); console.log(JSON.stringify({ db: sequelize.config.database, host: sequelize.config.host })); await sequelize.close();',
      ],
      { cwd: process.cwd(), env: childEnv, encoding: "utf8" }
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const parsed = JSON.parse(result.stdout.trim().split("\n").pop());
    assert.equal(parsed.db, "seed_real_db");
    assert.equal(parsed.host, "seed-db.internal");
    assert.notEqual(parsed.db, "dummy_db");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("Fase 10 - resolveSeedPassword e buildInitialUsers: usa env quando definido, gera fallback CSPRNG 32 chars e protege logs em produção (CWE-532)", async () => {
  const warnings = [];
  const mockLogger = {
    warn: (...args) => warnings.push(args.join(" ")),
  };

  // 1. Variáveis definidas no ambiente: retorna exatamente as configuradas sem logar
  const configuredAdmin = resolveSeedPassword({
    envVarName: "ADMIN_PASSWORD",
    username: "rwieruch",
    env: { NODE_ENV: "development", ADMIN_PASSWORD: "env-admin-password" },
    logger: mockLogger,
  });
  assert.equal(configuredAdmin, "env-admin-password");
  assert.equal(warnings.length, 0);

  const configuredUsers = buildInitialUsers({
    env: {
      NODE_ENV: "production",
      ADMIN_PASSWORD: "env-admin-password",
      USER_PASSWORD: "env-user-password",
    },
    logger: mockLogger,
  });
  assert.equal(configuredUsers.length, 2);
  assert.equal(configuredUsers[0].password, "env-admin-password");
  assert.equal(configuredUsers[1].password, "env-user-password");
  assert.equal(warnings.length, 0);

  // 2. Fallback em NODE_ENV=development: gera Base64 de 24 bytes (32 chars dentro de 7..42) e exibe no console
  const devWarnings = [];
  const devPassword = resolveSeedPassword({
    envVarName: "ADMIN_PASSWORD",
    username: "rwieruch",
    env: { NODE_ENV: "development" },
    logger: { warn: (...args) => devWarnings.push(args.join(" ")) },
  });
  assert.equal(devPassword.length, 32);
  assert.match(devPassword, /^[A-Za-z0-9+/]{32}$/);
  assert.ok(devPassword.length >= 7 && devPassword.length <= 42);
  assert.equal(devWarnings.length, 1);
  assert.ok(devWarnings[0].includes("ADMIN_PASSWORD não definida"));
  assert.ok(devWarnings[0].includes("'rwieruch'"));
  assert.ok(devWarnings[0].includes(devPassword));

  // 3. Fallback em NODE_ENV=production: gera senha CSPRNG e NUNCA vaza a senha no log (CWE-532)
  const prodWarnings = [];
  const prodPassword = resolveSeedPassword({
    envVarName: "USER_PASSWORD",
    username: "ddavids",
    env: { NODE_ENV: "production" },
    logger: { warn: (...args) => prodWarnings.push(args.join(" ")) },
  });
  assert.equal(prodPassword.length, 32);
  assert.match(prodPassword, /^[A-Za-z0-9+/]{32}$/);
  assert.equal(prodWarnings.length, 1);
  assert.ok(prodWarnings[0].includes("USER_PASSWORD não definida"));
  assert.ok(prodWarnings[0].includes("'ddavids'"));
  assert.equal(prodWarnings[0].includes(prodPassword), false);

  // 3b. NODE_ENV ausente (ex.: CI): também NUNCA vaza a senha no log
  const ciWarnings = [];
  const ciPassword = resolveSeedPassword({
    envVarName: "ADMIN_PASSWORD",
    username: "rwieruch",
    env: {},
    logger: { warn: (...args) => ciWarnings.push(args.join(" ")) },
  });
  assert.equal(ciWarnings.length, 1);
  assert.equal(ciWarnings[0].includes(ciPassword), false);

  // 4. Fallback em NODE_ENV=test: silencioso e aleatório a cada chamada
  const testWarnings = [];
  const generatedUsers = buildInitialUsers({
    env: { NODE_ENV: "test" },
    logger: { warn: (...args) => testWarnings.push(args.join(" ")) },
  });
  assert.equal(testWarnings.length, 0);
  assert.equal(generatedUsers[0].password.length, 32);
  assert.equal(generatedUsers[1].password.length, 32);
  assert.notEqual(generatedUsers[0].password, generatedUsers[1].password);

  // 5. createUsersWithMessages propaga env e logger personalizados dentro da transação
  const originalCreate = models.User.create;
  const originalTransaction = sequelize.transaction;
  const createdUserInputs = [];
  sequelize.transaction = async (cb) => await cb({ id: "tx-custom-seed" });
  models.User.create = async (data) => {
    createdUserInputs.push(data);
    return data;
  };
  try {
    await createUsersWithMessages({
      env: {
        NODE_ENV: "development",
        ADMIN_PASSWORD: "custom-admin-pass",
        USER_PASSWORD: "custom-user-pass",
      },
      logger: { warn: () => { throw new Error("Não deveria logar quando env definido"); } },
    });
    assert.equal(createdUserInputs[0].password, "custom-admin-pass");
    assert.equal(createdUserInputs[1].password, "custom-user-pass");
  } finally {
    models.User.create = originalCreate;
    sequelize.transaction = originalTransaction;
  }
});

test("Fase 10 - src/models/index.js e models.Message: desativa logging SQL fora de development e define VARCHAR(1000) em text", async () => {
  assert.equal(models.Message.rawAttributes.text.type._length, 1000);
  assert.ok(models.Message.rawAttributes.text.type.toSql().includes("1000"));
  assert.equal(sequelize.options.logging, false);

  const modelsIndexPath = path.resolve(process.cwd(), "src/models/index.js");
  const source = await fs.readFile(modelsIndexPath, "utf8");
  assert.ok(
    source.includes(
      'logging: process.env.NODE_ENV === "development" ? console.log : false'
    )
  );

  const baseEnv = {
    ...process.env,
    DATABASE_URL: "postgres://dummy:dummy@localhost:5432/dummy_db",
  };
  const prodRes = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'import { sequelize } from "./src/models/index.js"; console.log(JSON.stringify({ loggingType: typeof sequelize.options.logging, loggingVal: sequelize.options.logging })); await sequelize.close();',
    ],
    {
      cwd: process.cwd(),
      env: { ...baseEnv, NODE_ENV: "production" },
      encoding: "utf8",
    }
  );
  assert.equal(prodRes.status, 0, prodRes.stderr || prodRes.stdout);
  const prodInfo = JSON.parse(prodRes.stdout.trim().split("\n").pop());
  assert.equal(prodInfo.loggingVal, false);

  const devRes = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'import { sequelize } from "./src/models/index.js"; console.log(JSON.stringify({ loggingType: typeof sequelize.options.logging })); await sequelize.close();',
    ],
    {
      cwd: process.cwd(),
      env: { ...baseEnv, NODE_ENV: "development" },
      encoding: "utf8",
    }
  );
  assert.equal(devRes.status, 0, devRes.stderr || devRes.stdout);
  const devInfo = JSON.parse(devRes.stdout.trim().split("\n").pop());
  assert.equal(devInfo.loggingType, "function");
});
