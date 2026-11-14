import "dotenv/config";
import "./utils/env.js";
import express from "express";
import helmet from "helmet";
import { env } from "./utils/index.js";
import { sequelize } from "./models/index.js";
import { createUsersWithMessages } from "./seeders/index.js";
import {
  corsMiddleware,
  logMiddleware,
  authMiddleware,
  protectRoutes,
  notFoundMiddleware,
  errorMiddleware,
  limiterMiddleware,
} from "./middlewares/index.js";
import * as routes from "./routes/index.js";

const app = express();

app.set("trust proxy", 1);

// middlewares
app.use(helmet());
app.use(corsMiddleware);
app.use(limiterMiddleware);
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true, limit: "10kb" }));
app.use(logMiddleware);
app.use(authMiddleware);
app.use(protectRoutes);

// rotas
app.get("/", (req, res) => {
  return res.send("Servidor express executando...");
});
app.use("/", routes.docs);
app.use("/session", routes.session);
app.use("/users", routes.user);
app.use("/messages", routes.message);

// rota não encontrada (404)
app.use(notFoundMiddleware);

// middleware global de erro
app.use(errorMiddleware);

const port = env.PORT;

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

export default app;
