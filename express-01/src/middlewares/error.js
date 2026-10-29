import { ZodError } from "zod";
import { AppError } from "../utils/index.js";

const errorMiddleware = (err, req, res, next) => {
  const isDev = process.env.NODE_ENV !== "production";
  const isTest = process.env.NODE_ENV === "test";

  if (!isTest) {
    if (isDev) {
      console.error(err.stack);
    } else {
      console.error(`${err.name || "Error"}: ${err.message}`);
    }
  }

  if (err instanceof ZodError || err.name === "ZodError") {
    const formattedDetails = (err.issues || err.errors || []).map((e) => {
      const pathStr = e.path && e.path.length > 0 ? `${e.path.join(".")}: ` : "";
      return `${pathStr}${e.message}`;
    });
    return res.status(400).send({
      status: "fail",
      message: formattedDetails.join("; "),
      errors: formattedDetails,
      ...(isDev && { stack: err.stack }),
    });
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).send({
      status: err.status,
      message: err.message,
      ...(isDev && { stack: err.stack }),
    });
  }

  if (err.name === "SequelizeUniqueConstraintError") {
    return res.status(409).send({
      status: "fail",
      message: err.errors?.length
        ? err.errors.map((e) => e.message).join(", ")
        : "Registro duplicado.",
      ...(isDev && { stack: err.stack }),
    });
  }

  if (err.name === "SequelizeValidationError") {
    return res.status(400).send({
      status: "fail",
      message: err.errors?.length
        ? err.errors.map((e) => e.message).join(", ")
        : err.message,
      ...(isDev && { stack: err.stack }),
    });
  }

  if (err.name === "SequelizeDatabaseError" && err.original?.code === "22P02") {
    return res.status(400).send({
      status: "fail",
      message: "Identificador (ID) fornecido possui formato inválido.",
      ...(isDev && { stack: err.stack }),
    });
  }

  return res.status(500).send({
    status: "error",
    message: isDev ? err.message : "Algo deu errado no servidor.",
    ...(isDev && { stack: err.stack }),
  });
};

export default errorMiddleware;
