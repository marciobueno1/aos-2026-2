import { Router } from "express";
import { messageController } from "../controllers/index.js";
import {
  validate,
  isMessageOwner,
  createMessageSchema,
  updateMessageSchema,
  messageIdParamSchema,
  paginationQuerySchema,
} from "../middlewares/index.js";

const router = Router();

router.get("/", validate(paginationQuerySchema), messageController.getMessages);
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
  isMessageOwner,
  messageController.updateMessage
);
router.delete(
  "/:messageId",
  validate(messageIdParamSchema),
  isMessageOwner,
  messageController.deleteMessage
);

export default router;
