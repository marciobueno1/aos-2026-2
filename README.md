# aos-2026-2

Repositório da disciplina **Aplicações Orientadas a Serviços (AOS - 2026.2)** da **Universidade Católica de Pernambuco (UNICAP)**.

## Estrutura do Repositório

```text
aos-2026-2/
├── README.md
└── express-01/
    ├── .babelrc            # Configuração Babel (ESM Node 20+)
    ├── .env.sample         # Modelo de variáveis de ambiente
    ├── package.json        # Dependências e scripts da API
    ├── vercel.json         # Configuração de deploy (outputDirectory: dist)
    ├── src/
    │   ├── controllers/    # Manipuladores de requisição/resposta HTTP
    │   ├── docs/           # Especificação OpenAPI 3.0.3 e HTML do Swagger UI
    │   ├── middlewares/    # Segurança, CORS, Rate Limit, Auth/RBAC, Zod e Erros
    │   ├── models/         # Modelos Sequelize (User, Message, RefreshToken)
    │   ├── routes/         # Definição dos roteadores Express
    │   ├── seeders/        # Seeders oficiais Sequelize CLI e rotina programática
    │   ├── services/       # Regras de negócio e transações atômicas
    │   ├── utils/          # AppError, validação fail-fast de env, paginação e limpeza de tokens
    │   └── index.js        # Ponto de entrada da aplicação Express
    └── tests/              # Suíte de testes unitários com node:test
```

## Stack Principal

- **Runtime e Linguagem:** Node.js (ESM nativo `"type": "module"`) + Babel (`@babel/preset-env`)
- **Framework Web:** Express 5
- **Banco de Dados e ORM:** PostgreSQL + Sequelize 6
- **Autenticação e Criptografia:** Argon2 + JSON Web Tokens (`jsonwebtoken`) + Refresh Tokens opacos com rotação atômica
- **Validação:** Zod (startup `env` fail-fast e payloads/parâmetros/query)
- **Segurança:** Helmet, CORS dinâmico, `express-rate-limit`, limite de payload JSON/URL-encoded (`10kb`), RBAC/Ownership e sanitização CWE-200
- **Documentação Interativa:** OpenAPI 3.0.3 + Swagger UI (`/api-docs` e `/api-docs.json`)
- **Testes:** `node:test` nativo com relatório de cobertura (`--experimental-test-coverage`)

## Guia da API

Para instruções detalhadas de instalação, variáveis de ambiente, arquitetura, segurança, paginação, endpoints e exemplos com `cURL`, consulte o guia completo em:

- **[express-01/README.md](./express-01/README.md)**
