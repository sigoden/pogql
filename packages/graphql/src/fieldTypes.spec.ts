import { getTypeByScalarName } from "./fieldTypes";

describe("general types", () => {
  it("can get json type", () => {
    const typeClass = getTypeByScalarName("Json");
    expect(typeClass.name).toBe("Json");
  });

  it("get sequelize date type", () => {
    const typeClass = getTypeByScalarName("Date");
    expect(typeClass.sequelizeType).toBe("timestamp");
  });
});
