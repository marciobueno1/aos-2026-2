import { Router } from "express";
import { userController } from "../controllers/index.js";
import {
  validate,
  createUserSchema,
  updateUserSchema,
  userIdParamSchema,
} from "../middlewares/index.js";

const router = Router();

router.get("/", userController.getUsers);
router.get("/:userId", validate(userIdParamSchema), userController.getUser);
router.post("/", validate(createUserSchema), userController.createUser);
router.put(
  "/:userId",
  validate(userIdParamSchema),
  validate(updateUserSchema),
  userController.updateUser
);
router.delete(
  "/:userId",
  validate(userIdParamSchema),
  userController.deleteUser
);

export default router;
