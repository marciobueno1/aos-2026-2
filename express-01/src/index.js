import "dotenv/config";
import express from "express";
import models, { sequelize } from "./models/index.js";
import {
  corsMiddleware,
  logMiddleware,
  contextMiddleware,
} from "./middlewares/index.js";
import * as routes from "./routes/index.js";
import { AppError } from "./utils/index.js";

const app = express();

app.set("trust proxy", true);

// middlewares
app.use(corsMiddleware);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(logMiddleware);
app.use(contextMiddleware);

// rotas
app.get("/", (req, res) => {
  return res.send("Servidor express executando...");
});
app.use("/session", routes.session);
app.use("/users", routes.user);
app.use("/messages", routes.message);

// rota não encontrada (404)
app.use((req, res, next) => {
  next(new AppError(`Rota ${req.originalUrl} não encontrada no servidor.`, 404));
});

// middleware global de erro
app.use((err, req, res, next) => {
  const isDev = process.env.NODE_ENV !== "production";

  if (isDev) {
    console.error(err.stack);
  } else {
    console.error(`${err.name || "Error"}: ${err.message}`);
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
});

const port = process.env.PORT || 3000;

const eraseDatabaseOnSync = process.env.ERASE_DATABASE_ON_SYNC === "true";
const syncDatabase =
  process.env.SYNC_DATABASE === "true" || eraseDatabaseOnSync;

const startServer = () => {
  app.listen(port, () => console.log(`Example app listening on port ${port}!`));
};

if (syncDatabase) {
  sequelize.sync({ force: eraseDatabaseOnSync }).then(async () => {
    if (eraseDatabaseOnSync) {
      await createUsersWithMessages();
    }
    startServer();
  });
} else {
  startServer();
}

const createUsersWithMessages = async () => {
  await models.User.create(
    {
      username: "rwieruch",
      email: "rwieruch@email.com",
      messages: [
        {
          text: "Published the Road to learn React",
        },
      ],
    },
    {
      include: [models.Message],
    },
  );

  await models.User.create(
    {
      username: "ddavids",
      email: "ddavids@email.com",
      messages: [
        {
          text: "Happy to release ...",
        },
        {
          text: "Published a complete ...",
        },
      ],
    },
    {
      include: [models.Message],
    },
  );
};

export default app;
