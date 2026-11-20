import argon2 from "argon2";

const ARGON2_HASH_REGEX =
  /^\$argon2(?:id|i|d)\$v=\d+\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/;

const isArgon2Hash = (value) =>
  typeof value === "string" && ARGON2_HASH_REGEX.test(value);

const getUserModel = (sequelize, { DataTypes }) => {
  const User = sequelize.define("user", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    username: {
      type: DataTypes.STRING,
      unique: true,
      allowNull: false,
      validate: {
        notEmpty: true,
      },
    },
    email: {
      type: DataTypes.STRING,
      unique: true,
      allowNull: false,
      validate: {
        notEmpty: true,
      },
    },
    password: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: true,
        isValidPasswordLength(value) {
          // Se for hash Argon2 PHC válido pré-existente/gerado, ignora checagem de tamanho de texto puro
          if (isArgon2Hash(value)) {
            return;
          }
          if (!value || value.length < 7 || value.length > 42) {
            throw new Error("A senha deve ter entre 7 e 42 caracteres.");
          }
        },
      },
    },
    role: {
      type: DataTypes.ENUM("USER", "ADMIN"),
      allowNull: false,
      defaultValue: "USER",
    },
  });

  User.associate = (models) => {
    User.hasMany(models.Message, { foreignKey: "userId", onDelete: "CASCADE" });
    User.hasMany(models.RefreshToken, { foreignKey: "userId", onDelete: "CASCADE" });
  };

  User.beforeCreate(async (user) => {
    if (user.password && !isArgon2Hash(user.password)) {
      user.password = await user.generatePasswordHash();
    }
  });

  User.beforeUpdate(async (user) => {
    if (user.changed("password") && !isArgon2Hash(user.password)) {
      user.password = await user.generatePasswordHash();
    }
  });

  User.prototype.generatePasswordHash = async function () {
    return await argon2.hash(this.password);
  };

  User.prototype.validatePassword = async function (password) {
    return await argon2.verify(this.password, password);
  };

  /**
   * Sanitização de saída JSON (CWE-200):
   * Oculta a senha/hash de qualquer resposta serializada da API.
   */
  User.prototype.toJSON = function () {
    const values = { ...this.get() };
    delete values.password;
    return values;
  };

  User.findByLogin = async (login) => {
    if (typeof login !== "string") {
      return null;
    }

    const normalizedLogin = login.trim();
    if (!normalizedLogin) {
      return null;
    }

    if (normalizedLogin.includes("@")) {
      return await User.findOne({
        where: { email: normalizedLogin.toLowerCase() },
      });
    }

    return await User.findOne({
      where: { username: normalizedLogin },
    });
  };

  return User;
};

export default getUserModel;
