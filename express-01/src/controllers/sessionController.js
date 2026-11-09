import { sessionService } from "../services/index.js";
import { AppError } from "../utils/index.js";

const getSession = async (req, res) => {
  if (!req.context?.me) {
    throw new AppError("Acesso não autorizado. Autenticação obrigatória.", 401);
  }
  return res.status(200).send(req.context.me);
};

const login = async (req, res) => {
  const { login: userLogin, password } = req.body || {};
  const sessionData = await sessionService.authenticate(userLogin, password);
  return res.status(200).send(sessionData);
};

const refresh = async (req, res) => {
  const { refreshToken } = req.body || {};
  const sessionData = await sessionService.rotateRefreshToken(refreshToken);
  return res.status(200).send(sessionData);
};

const logout = async (req, res) => {
  const { refreshToken } = req.body || {};
  if (refreshToken) {
    await sessionService.destroyRefreshToken(refreshToken);
  }
  return res.status(204).send();
};

export default {
  getSession,
  login,
  refresh,
  logout,
};
