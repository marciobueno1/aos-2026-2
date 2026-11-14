import cors from "cors";
import { AppError } from "../utils/index.js";

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : ["http://localhost:3000", "http://localhost:3001"];

const CORS_EXPOSED_HEADERS = [
  "X-Total-Count",
  "X-Page",
  "X-Limit",
  "X-Total-Pages",
];

const corsOptionsDelegate = (req, callback) => {
  const origin = req.headers.origin;

  // Permite requisições sem 'Origin' (Expo/React Native nativo, mobile, cURL, Postman)
  if (!origin) {
    return callback(null, {
      origin: true,
      credentials: true,
      exposedHeaders: CORS_EXPOSED_HEADERS,
    });
  }

  if (allowedOrigins.includes(origin)) {
    return callback(null, {
      origin: true,
      credentials: true,
      exposedHeaders: CORS_EXPOSED_HEADERS,
    });
  }

  const clientIp = req.ip || req.socket?.remoteAddress || "desconhecido";
  const method = req.method;
  const path = req.originalUrl || req.url;

  return callback(
    new AppError(
      `Bloqueio de CORS: Origem '${origin}' não autorizada para o IP ${clientIp} em ${method} ${path}.`,
      403
    )
  );
};

export default cors(corsOptionsDelegate);
