import { Router } from "express";
import { sessionController } from "../controllers/index.js";
import {
  authLimiterMiddleware,
  validate,
  loginSchema,
  refreshTokenSchema,
} from "../middlewares/index.js";

const router = Router();

router.get("/", sessionController.getSession);
router.post(
  "/",
  authLimiterMiddleware,
  validate(loginSchema),
  sessionController.login
);
router.post(
  "/refresh",
  validate(refreshTokenSchema),
  sessionController.refresh
);
router.delete(
  "/",
  validate(refreshTokenSchema),
  sessionController.logout
);

export default router;
