import jwt from "jsonwebtoken";
import { env, AppError } from "../utils/index.js";
import { userService, messageService } from "../services/index.js";

const PUBLIC_ROUTES = [
  { method: "GET", path: "/" },
  { method: "HEAD", path: "/" },
  { method: "GET", path: "/api-docs" },
  { method: "HEAD", path: "/api-docs" },
  { method: "GET", path: "/api-docs.json" },
  { method: "HEAD", path: "/api-docs.json" },
  { method: "POST", path: "/session" },
  { method: "POST", path: "/session/refresh" },
  { method: "DELETE", path: "/session" },
  { method: "POST", path: "/users" },
];

const isPublicRoute = (req) => {
  if (req.method === "OPTIONS") {
    return true;
  }
  if (!req.method || req.path === undefined) {
    return false;
  }
  const rawPath = (req.baseUrl || "") + (req.path || "");
  const normalizedPath = rawPath.replace(/\/+$/, "") || "/";
  return PUBLIC_ROUTES.some(
    (route) => route.method === req.method && route.path === normalizedPath
  );
};

/**
 * Middleware de Autenticação JWT:
 * Intercepta o cabeçalho Authorization: Bearer <token>.
 * Valida a assinatura e expiração do Access Token.
 * Se válido, busca e injeta a instância do usuário autenticado em req.context.me.
 * Se o token for inválido ou expirado em rotas privadas, rejeita com 401.
 */
export const authMiddleware = async (req, res, next) => {
  if (!req.context) {
    req.context = {};
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    req.context.me = null;
    return next();
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    req.context.me = null;
    return next();
  }

  let payload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"] });
  } catch {
    if (isPublicRoute(req)) {
      req.context.me = null;
      return next();
    }
    return next(new AppError("Token inválido ou expirado.", 401));
  }

  if (!payload?.id) {
    if (isPublicRoute(req)) {
      req.context.me = null;
      return next();
    }
    return next(new AppError("Token com payload inválido.", 401));
  }

  try {
    const user = await userService.getUserById(payload.id);
    req.context.me = user || null;
    return next();
  } catch (err) {
    return next(err);
  }
};

/**
 * Middleware de Proteção de Rotas Privadas:
 * Bloqueia qualquer requisição não autenticada que tente acessar rotas restritas.
 * Mantém públicas estritamente:
 * - GET / e HEAD / (status do servidor)
 * - GET /api-docs e GET /api-docs.json (documentação Swagger/OpenAPI)
 * - POST /session (login)
 * - POST /session/refresh (renovação com rotação de refresh token)
 * - DELETE /session (logout por refresh token)
 * - POST /users (cadastro inicial / sign-up)
 * - OPTIONS * (preflight CORS)
 */
export const protectRoutes = (req, res, next) => {
  if (isPublicRoute(req)) {
    return next();
  }

  if (!req.context?.me) {
    return next(
      new AppError("Acesso não autorizado. Autenticação obrigatória.", 401)
    );
  }

  return next();
};

/**
 * Middleware de Controle de Acesso Baseado em Papéis (RBAC):
 * Restringe o acesso da rota aos papéis especificados.
 * Requer que `req.context.me` esteja autenticado.
 *
 * @param {...string} roles - Papéis autorizados (ex: "ADMIN", "USER")
 * @returns {import("express").RequestHandler}
 */
export const restrictTo = (...roles) => {
  return (req, res, next) => {
    const me = req.context?.me;
    if (!me || !roles.includes(me.role)) {
      return next(
        new AppError("Você não tem permissão para executar esta ação.", 403)
      );
    }

    return next();
  };
};

/**
 * Middleware de Validação de Propriedade de Mensagem:
 * Permite alteração/exclusão apenas ao autor da mensagem ou a um ADMIN.
 * Anexa a mensagem encontrada em `req.message` para evitar consultas duplicadas.
 */
export const isMessageOwner = async (req, res, next) => {
  try {
    const me = req.context?.me;
    if (!me) {
      return next(
        new AppError("Acesso não autorizado. Autenticação obrigatória.", 401)
      );
    }

    const message = await messageService.getMessageById(req.params.messageId);
    if (!message) {
      return next(new AppError("Mensagem não encontrada.", 404));
    }

    if (message.userId !== me.id && me.role !== "ADMIN") {
      return next(
        new AppError(
          "Você não tem permissão para alterar ou remover mensagens de outros usuários.",
          403
        )
      );
    }

    req.message = message;
    return next();
  } catch (err) {
    return next(err);
  }
};

/**
 * Middleware de Validação de Propriedade de Usuário:
 * Permite consulta/alteração/exclusão de cadastro apenas ao próprio titular ou a um ADMIN.
 */
export const isUserOwner = (req, res, next) => {
  const me = req.context?.me;
  if (!me) {
    return next(
      new AppError("Acesso não autorizado. Autenticação obrigatória.", 401)
    );
  }

  if (req.params.userId !== me.id && me.role !== "ADMIN") {
    return next(
      new AppError(
        "Você não tem permissão para modificar o cadastro de outro usuário.",
        403
      )
    );
  }

  return next();
};

export default {
  authMiddleware,
  protectRoutes,
  restrictTo,
  isMessageOwner,
  isUserOwner,
};
