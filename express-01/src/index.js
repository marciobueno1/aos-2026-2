import "dotenv/config";
import express from "express";
import models, { sequelize } from "./models/index.js";
import {
  corsMiddleware,
  logMiddleware,
  contextMiddleware,
  notFoundMiddleware,
  errorMiddleware,
} from "./middlewares/index.js";
import * as routes from "./routes/index.js";

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
app.use(notFoundMiddleware);

// middleware global de erro
app.use(errorMiddleware);

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
