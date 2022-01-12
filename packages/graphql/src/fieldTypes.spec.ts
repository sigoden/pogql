import { getFieldType } from "./fieldTypes";

describe("general types", () => {
  it("can get json type", () => {
    const typeClass = getFieldType("Json");
    expect(typeClass.name).toBe("Json");
  });
});
