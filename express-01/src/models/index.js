import Sequelize from "sequelize";
import pg from "pg";

import getUserModel from "./user.js";
import getMessageModel from "./message.js";
import getRefreshTokenModel from "./refreshToken.js";

const databaseUrl =
  process.env.DATABASE_URL || "postgres://dummy:dummy@localhost:5432/dummy_db";

const sequelize = new Sequelize(databaseUrl, {
  dialect: "postgres",
  dialectModule: pg,
  logging: process.env.NODE_ENV === "development" ? console.log : false,
});

const models = {
  User: getUserModel(sequelize, Sequelize),
  Message: getMessageModel(sequelize, Sequelize),
  RefreshToken: getRefreshTokenModel(sequelize, Sequelize),
};

Object.keys(models).forEach((key) => {
  if ("associate" in models[key]) {
    models[key].associate(models);
  }
});

export { sequelize };

export default models;
