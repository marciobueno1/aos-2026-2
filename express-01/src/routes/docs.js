import { Router } from "express";
import { openapiSpec, getSwaggerUiHtml } from "../docs/openapi.js";

const SWAGGER_CSP =
  "default-src 'self'; script-src 'self' https://unpkg.com 'unsafe-inline'; style-src 'self' https://unpkg.com 'unsafe-inline'; img-src 'self' data: https://unpkg.com; font-src 'self' https://unpkg.com data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'";

const router = Router();

router.get("/api-docs.json", (req, res) => {
  return res.status(200).json(openapiSpec);
});

router.get("/api-docs", (req, res) => {
  res.setHeader("Content-Security-Policy", SWAGGER_CSP);
  return res.status(200).type("html").send(getSwaggerUiHtml());
});

export default router;
