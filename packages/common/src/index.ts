import { isBuffer, isNull } from "lodash";
import { Model } from "sequelize";

export const GetterSetters = {
  BitInt: {
    get(self: Model, name: string) {
      return () => {
        const dataValue = self.getDataValue(name);
        return dataValue ? BigInt(dataValue) : null;
      };
    },
    set(self: Model, name: string) {
      return (val: unknown) => {
        self.setDataValue(name, val?.toString());
      };
    },
  },
  Bytes: {
    get(self: Model, name: string) {
      return () => {
        const dataValue = self.getDataValue(name);
        if (!dataValue) {
          return null;
        }
        if (!isBuffer(dataValue)) {
          throw new Error(`Bytes: get() returned type is not buffer type`);
        }
        return Buffer.from(dataValue).toString("hex");
      };
    },
    set(self: Model, name: string) {
      return (val: unknown) => {
        if (val === undefined || isNull(val)) {
          self.setDataValue(name, null);
        } else if (isHex(val)) {
          const str = val as string;
          if (str.startsWith("0x")) str.slice(2);
          const setValue = Buffer.from(str, "hex");
          self.setDataValue(name, setValue);
        } else {
          throw new Error(
            `input for Bytes type is only support unprefixed hex`
          );
        }
      };
    },
  },
};

const HEX_REGEX = /^0x[a-fA-F0-9]+$/;

export function isHex(value: unknown, bitLength = -1, ignoreLength = false) {
  return typeof value === "string" && (value === "0x" || HEX_REGEX.test(value))
    ? bitLength === -1
      ? value.length % 2 === 0 || ignoreLength
      : value.length === 2 + Math.ceil(bitLength / 4)
    : false;
}
