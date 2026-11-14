import { Router } from "express";
import { userController } from "../controllers/index.js";
import {
  validate,
  restrictTo,
  isUserOwner,
  createUserSchema,
  updateUserSchema,
  userIdParamSchema,
} from "../middlewares/index.js";

const router = Router();

router.get("/", restrictTo("ADMIN"), userController.getUsers);
router.get(
  "/:userId",
  validate(userIdParamSchema),
  isUserOwner,
  userController.getUser
);
router.post("/", validate(createUserSchema), userController.createUser);
router.put(
  "/:userId",
  validate(userIdParamSchema),
  isUserOwner,
  validate(updateUserSchema),
  userController.updateUser
);
router.delete(
  "/:userId",
  validate(userIdParamSchema),
  isUserOwner,
  userController.deleteUser
);

export default router;
