import { Router } from "express";
import { sessionController } from "../controllers/index.js";
import { authLimiterMiddleware } from "../middlewares/index.js";

const router = Router();

router.use(authLimiterMiddleware);

router.get("/", sessionController.getSession);

export default router;
