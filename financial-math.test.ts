import assert from "node:assert/strict";
import test from "node:test";
import { add, decimalString, divide, multiply, parseDecimal, roundTo } from "../src/lib/decimal";

const cents = (value: bigint) => decimalString(roundTo(value, 2));

test("currency purchase example uses exact fixed-point multiplication", () => {
  const quantity = parseDecimal("10000");
  const rate = parseDecimal("128.24");
  const total = roundTo(multiply(quantity, rate), 2);
  assert.equal(decimalString(total), "1282400");
});

test("sale profit uses posted weighted-average inventory cost", () => {
  const firstLot = multiply(parseDecimal("10000"), parseDecimal("128.24"));
  const secondLot = multiply(parseDecimal("5000"), parseDecimal("130"));
  const stockQuantity = add(parseDecimal("10000"), parseDecimal("5000"));
  const carryingValue = add(firstLot, secondLot);
  const averageCost = divide(carryingValue, stockQuantity);
  const soldQuantity = parseDecimal("10000");
  const costOfSale = roundTo(multiply(soldQuantity, averageCost), 2);
  const proceeds = roundTo(multiply(soldQuantity, parseDecimal("129")), 2);
  const realizedProfit = proceeds - costOfSale;
  const remainingQuantity = stockQuantity - soldQuantity;
  const remainingValue = carryingValue - costOfSale;

  assert.equal(decimalString(averageCost), "128.82666667");
  assert.equal(decimalString(proceeds), "1290000");
  assert.equal(cents(costOfSale), "1288266.67");
  assert.equal(cents(realizedProfit), "1733.33");
  assert.equal(decimalString(remainingQuantity), "5000");
  assert.equal(cents(remainingValue), "644133.33");
});

test("rounding uses decimal half-up without binary floating point", () => {
  assert.equal(cents(parseDecimal("1.005")), "1.01");
  assert.equal(cents(parseDecimal("-1.005")), "-1.01");
});

test("decimal parsing rejects excessive precision and malformed values", () => {
  assert.throws(() => parseDecimal("12.345678901"), /decimal/);
  assert.throws(() => parseDecimal("1e8"), /decimal/);
  assert.throws(() => parseDecimal("1,000"), /decimal/);
});
