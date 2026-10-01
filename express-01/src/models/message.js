const getMessageModel = (sequelize, { DataTypes }) => {
  const Message = sequelize.define("message", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    text: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: true,
      },
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
  });

  Message.associate = (models) => {
    Message.belongsTo(models.User, { foreignKey: "userId" });
  };

  return Message;
};

export default getMessageModel;
