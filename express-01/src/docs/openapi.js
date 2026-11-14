const errorResponseRef = (description) => ({
  description,
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ErrorResponse" },
    },
  },
});

const paginationHeaders = {
  "X-Total-Count": {
    description: "Quantidade total de registros disponíveis.",
    schema: { type: "integer", example: 25 },
  },
  "X-Page": {
    description: "Página atual retornada.",
    schema: { type: "integer", example: 1 },
  },
  "X-Limit": {
    description: "Limite máximo de itens por página.",
    schema: { type: "integer", example: 10 },
  },
  "X-Total-Pages": {
    description: "Quantidade total de páginas calculadas.",
    schema: { type: "integer", example: 3 },
  },
};

const commonMutationResponses = {
  400: errorResponseRef("Dados inválidos (Zod/Sequelize) ou JSON malformado."),
  413: errorResponseRef(
    "Payload da requisição excede o limite máximo permitido (10kb)."
  ),
  429: errorResponseRef("Limite de taxa de requisições excedido."),
  500: errorResponseRef("Erro interno inesperado no servidor."),
};

/**
 * Especificação OpenAPI 3.0.3 completa da API express-01.
 */
export const openapiSpec = {
  openapi: "3.0.3",
  info: {
    title: "API express-01 — AOS 2026.2 (UNICAP)",
    version: "1.0.0",
    description:
      "API RESTful em camadas com Node.js (ESM), Express 5, Sequelize e PostgreSQL. Inclui autenticação JWT + Refresh Tokens com rotação atômica, Argon2, RBAC, validação com Zod, paginação via headers HTTP e proteção contra abuso.",
  },
  servers: [
    { url: "/", description: "Servidor atual" },
    { url: "http://localhost:4001", description: "Ambiente de desenvolvimento local" },
  ],
  tags: [
    { name: "Sistema", description: "Healthcheck e documentação OpenAPI" },
    { name: "Sessão", description: "Autenticação, renovação de tokens e logout" },
    { name: "Usuários", description: "Gerenciamento de contas e perfis (RBAC)" },
    { name: "Mensagens", description: "CRUD de mensagens com validação de propriedade" },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Access Token JWT obtido em POST /session ou POST /session/refresh.",
      },
    },
    parameters: {
      PageParam: {
        name: "page",
        in: "query",
        required: false,
        description: "Número da página (1 a 1000000).",
        schema: { type: "integer", minimum: 1, maximum: 1000000, default: 1 },
      },
      LimitParam: {
        name: "limit",
        in: "query",
        required: false,
        description: "Quantidade máxima de itens por página (1 a 100).",
        schema: { type: "integer", minimum: 1, maximum: 100, default: 10 },
      },
      OrderParam: {
        name: "order",
        in: "query",
        required: false,
        description: "Direção da ordenação por data de criação e ID.",
        schema: { type: "string", enum: ["ASC", "DESC"], default: "DESC" },
      },
      UserIdParam: {
        name: "userId",
        in: "path",
        required: true,
        description: "Identificador UUID v4 do usuário.",
        schema: { type: "string", format: "uuid" },
      },
      MessageIdParam: {
        name: "messageId",
        in: "path",
        required: true,
        description: "Identificador UUID v4 da mensagem.",
        schema: { type: "string", format: "uuid" },
      },
    },
    schemas: {
      User: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          username: { type: "string", example: "rwieruch" },
          email: { type: "string", format: "email", example: "rwieruch@email.com" },
          role: { type: "string", enum: ["USER", "ADMIN"], example: "USER" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
        required: ["id", "username", "email", "role"],
      },
      CreateUserInput: {
        type: "object",
        properties: {
          username: { type: "string", minLength: 1, example: "alice" },
          email: { type: "string", format: "email", example: "alice@unicap.br" },
          password: { type: "string", minLength: 7, maxLength: 42, example: "password123" },
        },
        required: ["username", "email", "password"],
      },
      UpdateUserInput: {
        type: "object",
        minProperties: 1,
        properties: {
          username: { type: "string", minLength: 1, example: "alice_novo" },
          email: { type: "string", format: "email", example: "alice_novo@unicap.br" },
          password: { type: "string", minLength: 7, maxLength: 42, example: "novasenha123" },
          role: {
            type: "string",
            enum: ["USER", "ADMIN"],
            description: "Alteração permitida exclusivamente para usuários com papel ADMIN.",
          },
        },
      },
      Message: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          text: { type: "string", maxLength: 1000, example: "Olá, turma de AOS!" },
          userId: { type: "string", format: "uuid" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
        required: ["id", "text", "userId"],
      },
      MessageInput: {
        type: "object",
        properties: {
          text: { type: "string", minLength: 1, maxLength: 1000, example: "Nova mensagem" },
        },
        required: ["text"],
      },
      LoginInput: {
        type: "object",
        properties: {
          login: {
            type: "string",
            description: "Username ou e-mail cadastrado.",
            example: "rwieruch",
          },
          password: { type: "string", example: "password123" },
        },
        required: ["login", "password"],
      },
      RefreshTokenInput: {
        type: "object",
        properties: {
          refreshToken: {
            type: "string",
            description: "Token opaco de 80 caracteres hexadecimais.",
          },
        },
        required: ["refreshToken"],
      },
      SessionResponse: {
        type: "object",
        properties: {
          accessToken: { type: "string" },
          refreshToken: { type: "string" },
          user: { $ref: "#/components/schemas/User" },
        },
        required: ["accessToken", "refreshToken", "user"],
      },
      ErrorResponse: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["fail", "error"], example: "fail" },
          message: { type: "string", example: "Descrição do erro ocorrido." },
          errors: {
            type: "array",
            items: { type: "string" },
          },
          stack: { type: "string" },
        },
        required: ["status", "message"],
      },
    },
  },
  paths: {
    "/": {
      get: {
        tags: ["Sistema"],
        summary: "Verifica saúde da API",
        responses: {
          200: {
            description: "Servidor em execução.",
            content: {
              "text/plain": { schema: { type: "string", example: "Servidor express executando..." } },
            },
          },
          429: commonMutationResponses[429],
          500: commonMutationResponses[500],
        },
      },
    },
    "/api-docs": {
      get: {
        tags: ["Sistema"],
        summary: "Interface visual interativa Swagger UI",
        responses: {
          200: {
            description: "Página HTML com Swagger UI.",
            content: { "text/html": { schema: { type: "string" } } },
          },
          429: commonMutationResponses[429],
        },
      },
    },
    "/api-docs.json": {
      get: {
        tags: ["Sistema"],
        summary: "Especificação OpenAPI 3.0.3 em JSON",
        responses: {
          200: {
            description: "Documento OpenAPI JSON.",
            content: { "application/json": { schema: { type: "object" } } },
          },
          429: commonMutationResponses[429],
        },
      },
    },
    "/session": {
      get: {
        tags: ["Sessão"],
        summary: "Retorna o usuário autenticado na sessão atual",
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: "Dados do usuário autenticado.",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/User" } },
            },
          },
          401: errorResponseRef("Token JWT ausente, inválido ou expirado."),
          429: commonMutationResponses[429],
          500: commonMutationResponses[500],
        },
      },
      post: {
        tags: ["Sessão"],
        summary: "Autentica usuário e emite Access Token JWT e Refresh Token",
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/LoginInput" } },
          },
        },
        responses: {
          200: {
            description: "Autenticação bem-sucedida.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SessionResponse" },
              },
            },
          },
          ...commonMutationResponses,
          401: errorResponseRef("Credenciais inválidas."),
        },
      },
      delete: {
        tags: ["Sessão"],
        summary: "Encerra sessão revogando o Refresh Token",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RefreshTokenInput" },
            },
          },
        },
        responses: {
          204: { description: "Sessão encerrada com sucesso." },
          ...commonMutationResponses,
        },
      },
    },
    "/session/refresh": {
      post: {
        tags: ["Sessão"],
        summary: "Rotaciona o Refresh Token e emite novo par de tokens",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RefreshTokenInput" },
            },
          },
        },
        responses: {
          200: {
            description: "Tokens rotacionados atomicamente.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SessionResponse" },
              },
            },
          },
          ...commonMutationResponses,
          401: errorResponseRef("Refresh token inválido ou expirado."),
        },
      },
    },
    "/users": {
      get: {
        tags: ["Usuários"],
        summary: "Lista usuários de forma paginada (restrito a ADMIN)",
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: "#/components/parameters/PageParam" },
          { $ref: "#/components/parameters/LimitParam" },
          { $ref: "#/components/parameters/OrderParam" },
        ],
        responses: {
          200: {
            description: "Lista paginada de usuários.",
            headers: paginationHeaders,
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/User" },
                },
              },
            },
          },
          400: errorResponseRef("Parâmetros de paginação inválidos."),
          401: errorResponseRef("Autenticação obrigatória."),
          403: errorResponseRef("Acesso restrito a administradores."),
          429: commonMutationResponses[429],
          500: commonMutationResponses[500],
        },
      },
      post: {
        tags: ["Usuários"],
        summary: "Cadastro público de novo usuário (sempre com papel USER)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateUserInput" },
            },
          },
        },
        responses: {
          201: {
            description: "Usuário criado com sucesso.",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/User" } },
            },
          },
          ...commonMutationResponses,
          409: errorResponseRef("Conflito de unicidade em username ou email."),
        },
      },
    },
    "/users/{userId}": {
      get: {
        tags: ["Usuários"],
        summary: "Consulta usuário por ID (próprio titular ou ADMIN)",
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/UserIdParam" }],
        responses: {
          200: {
            description: "Usuário encontrado.",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/User" } },
            },
          },
          400: errorResponseRef("UUID inválido."),
          401: errorResponseRef("Autenticação obrigatória."),
          403: errorResponseRef("Acesso negado ao cadastro de outro usuário."),
          404: errorResponseRef("Usuário não encontrado."),
          429: commonMutationResponses[429],
          500: commonMutationResponses[500],
        },
      },
      put: {
        tags: ["Usuários"],
        summary: "Atualiza usuário por ID (próprio titular ou ADMIN)",
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/UserIdParam" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/UpdateUserInput" },
            },
          },
        },
        responses: {
          200: {
            description: "Usuário atualizado com sucesso.",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/User" } },
            },
          },
          ...commonMutationResponses,
          401: errorResponseRef("Autenticação obrigatória."),
          403: errorResponseRef("Sem permissão para editar usuário ou alterar role."),
          404: errorResponseRef("Usuário não encontrado."),
          409: errorResponseRef("Conflito de unicidade em username ou email."),
        },
      },
      delete: {
        tags: ["Usuários"],
        summary: "Remove usuário por ID (próprio titular ou ADMIN)",
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/UserIdParam" }],
        responses: {
          204: { description: "Usuário removido com sucesso." },
          400: errorResponseRef("UUID inválido."),
          401: errorResponseRef("Autenticação obrigatória."),
          403: errorResponseRef("Sem permissão para remover outro usuário."),
          404: errorResponseRef("Usuário não encontrado."),
          429: commonMutationResponses[429],
          500: commonMutationResponses[500],
        },
      },
    },
    "/messages": {
      get: {
        tags: ["Mensagens"],
        summary: "Lista mensagens de forma paginada",
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: "#/components/parameters/PageParam" },
          { $ref: "#/components/parameters/LimitParam" },
          { $ref: "#/components/parameters/OrderParam" },
        ],
        responses: {
          200: {
            description: "Lista paginada de mensagens.",
            headers: paginationHeaders,
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Message" },
                },
              },
            },
          },
          400: errorResponseRef("Parâmetros de paginação inválidos."),
          401: errorResponseRef("Autenticação obrigatória."),
          429: commonMutationResponses[429],
          500: commonMutationResponses[500],
        },
      },
      post: {
        tags: ["Mensagens"],
        summary: "Cria nova mensagem vinculada ao usuário autenticado",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/MessageInput" },
            },
          },
        },
        responses: {
          201: {
            description: "Mensagem criada com sucesso.",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Message" } },
            },
          },
          ...commonMutationResponses,
          401: errorResponseRef("Autenticação obrigatória."),
        },
      },
    },
    "/messages/{messageId}": {
      get: {
        tags: ["Mensagens"],
        summary: "Consulta mensagem por ID",
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/MessageIdParam" }],
        responses: {
          200: {
            description: "Mensagem encontrada.",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Message" } },
            },
          },
          400: errorResponseRef("UUID inválido."),
          401: errorResponseRef("Autenticação obrigatória."),
          404: errorResponseRef("Mensagem não encontrada."),
          429: commonMutationResponses[429],
          500: commonMutationResponses[500],
        },
      },
      put: {
        tags: ["Mensagens"],
        summary: "Atualiza mensagem por ID (autor ou ADMIN)",
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/MessageIdParam" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/MessageInput" },
            },
          },
        },
        responses: {
          200: {
            description: "Mensagem atualizada com sucesso.",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Message" } },
            },
          },
          ...commonMutationResponses,
          401: errorResponseRef("Autenticação obrigatória."),
          403: errorResponseRef("Sem permissão para alterar mensagem de outro usuário."),
          404: errorResponseRef("Mensagem não encontrada."),
        },
      },
      delete: {
        tags: ["Mensagens"],
        summary: "Remove mensagem por ID (autor ou ADMIN)",
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/MessageIdParam" }],
        responses: {
          204: { description: "Mensagem removida com sucesso." },
          400: errorResponseRef("UUID inválido."),
          401: errorResponseRef("Autenticação obrigatória."),
          403: errorResponseRef("Sem permissão para remover mensagem de outro usuário."),
          404: errorResponseRef("Mensagem não encontrada."),
          429: commonMutationResponses[429],
          500: commonMutationResponses[500],
        },
      },
    },
  },
};

/**
 * Gera a página HTML do Swagger UI carregando swagger-ui-dist@5 via CDN.
 *
 * @param {string} [specUrl="/api-docs.json"]
 * @returns {string}
 */
export const getSwaggerUiHtml = (specUrl = "/api-docs.json") => `<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Documentação da API - express-01</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.onload = () => {
        window.ui = SwaggerUIBundle({
          url: ${JSON.stringify(specUrl).replace(/</g, "\\u003c")},
          dom_id: "#swagger-ui",
          deepLinking: true,
          persistAuthorization: true,
        });
      };
    </script>
  </body>
</html>`;

export default openapiSpec;
