import models from "../models/index.js";
import { findPaginated } from "../utils/index.js";

const getAllMessages = async ({
  page = 1,
  limit = 10,
  order = "DESC",
} = {}) => {
  return await findPaginated(models.Message, { page, limit, order });
};

const getMessageById = async (id) => {
  return await models.Message.findByPk(id);
};

const createMessage = async ({ text, userId }) => {
  return await models.Message.create({
    text,
    userId,
  });
};

const updateMessage = async (id, { text }, existingMessage = null) => {
  const message = existingMessage || (await getMessageById(id));
  if (!message) {
    return null;
  }
  return await message.update({
    ...(text !== undefined && { text }),
  });
};

const deleteMessage = async (id) => {
  const count = await models.Message.destroy({
    where: { id },
  });
  return count > 0;
};

export default {
  getAllMessages,
  getMessageById,
  createMessage,
  updateMessage,
  deleteMessage,
};
