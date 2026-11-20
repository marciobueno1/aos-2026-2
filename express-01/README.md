# express-01 — API RESTful Segura em Camadas (AOS 2026.2)

Projeto de referência da disciplina **Aplicações Orientadas a Serviços (UNICAP - 2026.2)** desenvolvido com Node.js (ESM), Express 5, Sequelize 6 e PostgreSQL.

---

## 1. Arquitetura em Camadas

O código-fonte em `src/` segue o princípio da Responsabilidade Única (SRP) dividido nas seguintes camadas:

- **`src/routes/`**: Mapeamento de endpoints HTTP e composição da cadeia de middlewares (`session.js`, `user.js`, `message.js`, `docs.js`).
- **`src/middlewares/`**:
  - `cors.js`: Política CORS dinâmica baseada em `ALLOWED_ORIGINS` com suporte a clientes mobile/cURL (sem cabeçalho `Origin`) e exposição dos cabeçalhos de paginação (`exposedHeaders`).
  - `rateLimiter.js`: Limitação de taxa global (`100` req / 15 min) e estrita no login (`5` req / 15 min em `POST /session`).
  - `auth.js`: Autenticação JWT (`authMiddleware`), bloqueio padrão de rotas privadas (`protectRoutes`), controle baseado em papéis (`restrictTo`) e validação de propriedade (`isMessageOwner`, `isUserOwner`).
  - `validate.js` & `validationSchemas.js`: Validação assíncrona concorrente de `body`, `params` e `query` com Zod (compatível com o getter read-only `req.query` do Express 5).
  - `error.js` & `notFound.js`: Tratamento global padronizado para `AppError`, `ZodError`, erros do Sequelize (`409` unicidade, `400` validação, `22P02` UUID inválido), payload excedido (`413`), JSON malformado (`400`) e erros internos (`500`).
- **`src/controllers/`**: Extração explícita dos dados validados (prevenção contra *Mass Assignment*), definição de metadados HTTP e resposta padronizada.
- **`src/services/`**: Regras de negócio, hash/rotação de refresh tokens e operações transacionais atômicas com `sequelize.transaction` e locking pessimista (`FOR UPDATE` / `FOR UPDATE OF`).
- **`src/models/`**: Definição das entidades `User`, `Message` e `RefreshToken` com chaves primárias UUID v4, hooks Argon2 e sanitização `toJSON()`.
- **`src/seeders/`**: Seeder oficial Sequelize CLI (`20261114000001-initial-users-with-messages.js`) e executor programático (`runSeeders` / `createUsersWithMessages`).
- **`src/docs/`**: Especificação OpenAPI 3.0.3 (`openapi.js`) e gerador HTML para Swagger UI.
- **`src/utils/`**: `AppError`, validação *fail-fast* de variáveis de ambiente (`env.js`), utilitário de paginação (`pagination.js`) e limpeza de tokens expirados (`tokenCleanup.js`).

---

## 2. Configuração Inicial

### Pré-requisitos
- Node.js 20+
- Banco de dados PostgreSQL acessível

### Passos de Configuração

1. Acesse o diretório do projeto e instale as dependências:
   ```bash
   cd express-01
   npm install
   ```

2. Crie o arquivo `.env` a partir do modelo `.env.sample`:
   ```bash
   cp .env.sample .env
   ```

3. Preencha as variáveis no `.env`:

| Variável | Obrigatória | Padrão | Descrição |
| :--- | :--- | :--- | :--- |
| `DATABASE_URL` | Sim | — | URL de conexão PostgreSQL |
| `JWT_SECRET` | Sim* | — | Segredo HMAC-SHA256 com no mínimo 10 caracteres (recomendado: `openssl rand -base64 48`). Em `production`, valores públicos de exemplo são rejeitados no startup (*fallback legado para `MY_SECRET`) |
| `ALLOWED_ORIGINS` | Sim | — | Lista de origens CORS separadas por vírgula (ex: `http://localhost:3000,http://localhost:3001`) |
| `PORT` | Não | `4001` | Porta HTTP do servidor Express |
| `NODE_ENV` | Não | `development` | Ambiente de execução (`development`, `production`, `test`) |
| `SYNC_DATABASE` | Não | `false` | Sincroniza tabelas do Sequelize no startup (`"true"` ou `"false"`) |
| `ERASE_DATABASE_ON_SYNC` | Não | `false` | Recria tabelas e executa o seed inicial no startup (`"true"` ou `"false"`). Bloqueado quando `NODE_ENV=production` |
| `ADMIN_PASSWORD` | Não | Aleatória (`crypto.randomBytes(24).toString("base64")`) | Senha inicial (7 a 42 caracteres) do usuário `rwieruch` no seeder. Quando omitida, o seeder gera uma senha aleatória de 32 caracteres (equivalente a `openssl rand -base64 24`), exibida no console **somente** com `NODE_ENV=development` e omitida dos logs nos demais ambientes, inclusive CI sem `NODE_ENV` (CWE-532) |
| `USER_PASSWORD` | Não | Aleatória (`crypto.randomBytes(24).toString("base64")`) | Senha inicial (7 a 42 caracteres) do usuário `ddavids` no seeder. Segue o mesmo fallback criptográfico e regra de logging de `ADMIN_PASSWORD` |

> **Primeiro boot (criação de tabelas + seed inicial):**
> Para inicializar o schema no PostgreSQL e popular os usuários padrão na primeira execução, inicie o servidor uma vez com:
> ```bash
> SYNC_DATABASE=true ERASE_DATABASE_ON_SYNC=true npm run dev
> ```
> Após a inicialização, mantenha ambas como `false` no `.env` para preservar os dados entre reinícios.

> **Atualizando um banco criado antes do Passo 11:**
> O `sequelize.sync()` **não altera colunas de tabelas existentes**. Se o seu banco foi criado antes do Passo 11, a coluna `messages.text` ainda é `VARCHAR(255)` e mensagens entre 256 e 1000 caracteres serão recusadas com HTTP 400. Rode uma vez no seu PostgreSQL:
> ```sql
> ALTER TABLE "messages" ALTER COLUMN "text" TYPE VARCHAR(1000);
> ```
> Em projetos de produção, esse tipo de mudança deve virar uma **migration versionada** (ex.: `sequelize-cli` ou `umzug`).

---

## 3. Scripts Disponíveis (`package.json`)

| Script | Comando | Finalidade |
| :--- | :--- | :--- |
| `npm run dev` | `nodemon --exec babel-node src/index.js` | Servidor em desenvolvimento com hot-reload |
| `npm run build` | `babel src -d dist` | Compila os arquivos ESM de `src/` para `dist/` |
| `npm start` | `node dist/index.js` | Executa o build de produção a partir de `dist/` |
| `npm test` | `NODE_ENV=test node --test tests/**/*.test.js` | Executa a suíte de testes unitários |
| `npm run test:coverage` | `NODE_ENV=test node --test --experimental-test-coverage tests/**/*.test.js` | Executa testes unitários exibindo cobertura de linhas, branches e funções |
| `npm run db:seed` | `node -e 'import("./src/seeders/index.js").then((m) => m.runSeeders())'` | Executa o seeder inicial via CLI com fechamento seguro da conexão |
| `npm run db:clean-tokens` | `node -e 'import("./src/utils/tokenCleanup.js")'` | Remove do banco todos os refresh tokens expirados (`expiresAt < NOW`) |

---

## 4. Recursos de Segurança Implementados

- **Helmet & CSP Específico**: Remove `X-Powered-By` e aplica cabeçalhos de proteção (`X-Content-Type-Options: nosniff`, `X-Frame-Options`, `Content-Security-Policy` estrita por padrão, flexibilizada apenas em `GET /api-docs` para o Swagger UI).
- **CORS Dinâmico**: Lista branca configurada via `ALLOWED_ORIGINS`, bloqueio com `AppError 403` rastreável em log, suporte a clientes nativos/cURL e exposição dos cabeçalhos de paginação (`X-Total-Count`, `X-Page`, `X-Limit`, `X-Total-Pages`).
- **Rate Limiting**: Limite global de 100 req / 15 min (`limiterMiddleware`) e limite dedicado de 5 req / 15 min em `POST /session` (`authLimiterMiddleware`) contra força bruta.
- **Hardening de Payload**: Parsers `express.json` e `express.urlencoded` limitados a `10kb` com resposta padronizada `413` (payload excedido) e `400` (JSON malformado).
- **Validação Fail-Fast & Schemas Zod**: Validação estrita do `.env` na inicialização (`src/utils/env.js`) e sanitização de entradas (`body`, `params`, `query`) antes dos controllers.
- **Argon2 + JWT + Refresh Tokens Atômicos**: Senhas armazenadas com Argon2 (nunca expostas em respostas JSON graças a `User.prototype.toJSON` — mitigação CWE-200); Access Token JWT curto (`15m`, `HS256`) com claim `role`; Refresh Token opaco de 40 bytes armazenado como hash SHA-256 e rotacionado dentro de `sequelize.transaction` com locking pessimista (`FOR UPDATE OF`).
- **RBAC, Ownership e Anti-Mass Assignment**: Separação entre `ADMIN` e `USER`, verificação de propriedade (`isUserOwner`, `isMessageOwner`), bloqueio contra alteração indevida de `role` (no controller e no serviço) e revogação transacional de todos os refresh tokens quando `password` ou `role` são alterados.

---

## 5. Paginação e Ordenação

Os endpoints de listagem `GET /users` (restrito a `ADMIN`) e `GET /messages` suportam paginação e ordenação via query string validada pelo `paginationQuerySchema`:

- `page` (inteiro entre `1` e `1000000`, padrão: `1`)
- `limit` (inteiro entre `1` e `100`, padrão: `10`)
- `order` (`ASC` ou `DESC`, case-insensitive, padrão: `DESC`, ordenado por `createdAt` e `id`)

Para manter retrocompatibilidade de contrato, o corpo da resposta continua sendo um array JSON, enquanto os metadados são entregues nos cabeçalhos HTTP (também expostos no CORS):

- `X-Total-Count`: total de registros
- `X-Page`: página atual
- `X-Limit`: limite aplicado por página
- `X-Total-Pages`: quantidade total de páginas

---

## 6. Documentação Interativa (Swagger / OpenAPI 3.0)

Com o servidor em execução, acesse:

- **Swagger UI:** `http://localhost:4001/api-docs`
- **Especificação JSON (OpenAPI 3.0.3):** `http://localhost:4001/api-docs.json`

Para testar rotas protegidas no Swagger UI, autentique-se em `POST /session`, copie o `accessToken` e clique no botão **Authorize** inserindo o token JWT.

---

## 7. Endpoints e Credenciais do Seed

### Usuários Padrão do Seed

| Usuário | E-mail | Origem da Senha | Papel (`role`) |
| :--- | :--- | :--- | :--- |
| `rwieruch` | `rwieruch@email.com` | `ADMIN_PASSWORD` no `.env` (ou senha CSPRNG exibida no console no boot inicial em dev) | `ADMIN` |
| `ddavids` | `ddavids@email.com` | `USER_PASSWORD` no `.env` (ou senha CSPRNG exibida no console no boot inicial em dev) | `USER` |

### Mapa de Rotas

| Método | Rota | Acesso | Descrição |
| :--- | :--- | :--- | :--- |
| `GET` / `HEAD` | `/` | Público | Status do servidor |
| `GET` / `HEAD` | `/api-docs` | Público | Interface visual Swagger UI |
| `GET` / `HEAD` | `/api-docs.json` | Público | Especificação OpenAPI 3.0.3 em JSON |
| `POST` | `/session` | Público (5 req/15min) | Login e emissão de Access + Refresh Token |
| `POST` | `/session/refresh` | Público | Rotação atômica do Refresh Token |
| `DELETE` | `/session` | Público | Logout (revogação do Refresh Token) |
| `GET` | `/session` | Autenticado | Dados do usuário da sessão atual |
| `POST` | `/users` | Público | Cadastro de novo usuário (sempre `USER`) |
| `GET` | `/users` | `ADMIN` | Listagem paginada de usuários |
| `GET` | `/users/:userId` | Titular ou `ADMIN` | Consulta de usuário por UUID |
| `PUT` | `/users/:userId` | Titular ou `ADMIN` | Atualização de usuário (`role` apenas `ADMIN`) |
| `DELETE` | `/users/:userId` | Titular ou `ADMIN` | Exclusão de usuário por UUID |
| `GET` | `/messages` | Autenticado | Listagem paginada de mensagens |
| `GET` | `/messages/:messageId` | Autenticado | Consulta de mensagem por UUID |
| `POST` | `/messages` | Autenticado | Criação de mensagem |
| `PUT` | `/messages/:messageId` | Autor ou `ADMIN` | Atualização de mensagem |
| `DELETE` | `/messages/:messageId` | Autor ou `ADMIN` | Exclusão de mensagem |

---

## 8. Exemplos Rápidos com `cURL`

### Autenticar (`POST /session`)
```bash
curl -s -X POST http://localhost:4001/session \
  -H "Content-Type: application/json" \
  -d '{"login": "rwieruch", "password": "<SUA_ADMIN_PASSWORD_OU_SENHA_DO_BOOT>"}'
```

### Listar mensagens com paginação e cabeçalhos (`GET /messages`)
```bash
curl -i "http://localhost:4001/messages?page=1&limit=2&order=ASC" \
  -H "Authorization: Bearer SEU_ACCESS_TOKEN"
```

### Criar uma mensagem (`POST /messages`)
```bash
curl -s -X POST http://localhost:4001/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer SEU_ACCESS_TOKEN" \
  -d '{"text": "Olá a partir do cURL!"}'
```

### Renovar sessão com rotação de token (`POST /session/refresh`)
```bash
curl -s -X POST http://localhost:4001/session/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken": "SEU_REFRESH_TOKEN"}'
```

### Encerrar sessão (`DELETE /session`)
```bash
curl -i -X DELETE http://localhost:4001/session \
  -H "Content-Type: application/json" \
  -d '{"refreshToken": "SEU_REFRESH_TOKEN"}'
```
