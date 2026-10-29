import { Router } from "express";
import { messageController } from "../controllers/index.js";
import {
  validate,
  createMessageSchema,
  updateMessageSchema,
  messageIdParamSchema,
} from "../middlewares/index.js";

const router = Router();

router.get("/", messageController.getMessages);
router.get(
  "/:messageId",
  validate(messageIdParamSchema),
  messageController.getMessage
);
router.post(
  "/",
  validate(createMessageSchema),
  messageController.createMessage
);
router.put(
  "/:messageId",
  validate(messageIdParamSchema),
  validate(updateMessageSchema),
  messageController.updateMessage
);
router.delete(
  "/:messageId",
  validate(messageIdParamSchema),
  messageController.deleteMessage
);

export default router;
