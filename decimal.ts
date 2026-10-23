export const DECIMAL_PLACES = 8;
export const SCALE = BigInt(100_000_000);
const powers = [BigInt(1), BigInt(10), BigInt(100), BigInt(1_000), BigInt(10_000), BigInt(100_000), BigInt(1_000_000), BigInt(10_000_000), SCALE];
const ZERO = BigInt(0);

export function parseDecimal(value: string | null | undefined, label = "Amount"): bigint {
  const normalized = (value ?? "").trim();
  if (!/^-?\d+(?:\.\d{1,8})?$/.test(normalized)) {
    throw new Error(`${label} must be a decimal with no more than 8 fractional digits.`);
  }
  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const result = BigInt(whole) * SCALE + BigInt((fraction + "00000000").slice(0, 8));
  return negative ? -result : result;
}

export function decimalString(value: bigint, trim = true): string {
  const negative = value < ZERO;
  const absolute = negative ? -value : value;
  const whole = absolute / SCALE;
  const fraction = (absolute % SCALE).toString().padStart(8, "0");
  const decimals = trim ? fraction.replace(/0+$/, "") : fraction;
  const output = decimals ? `${whole}.${decimals}` : whole.toString();
  return negative && absolute !== ZERO ? `-${output}` : output;
}

export function multiply(left: bigint, right: bigint): bigint {
  const product = left * right;
  const negative = product < ZERO;
  const absolute = negative ? -product : product;
  const quotient = absolute / SCALE;
  const remainder = absolute % SCALE;
  const rounded = quotient + (remainder * BigInt(2) >= SCALE ? BigInt(1) : ZERO);
  return negative ? -rounded : rounded;
}

export function divide(dividend: bigint, divisor: bigint): bigint {
  if (divisor === ZERO) throw new Error("Cannot divide by zero.");
  const numerator = dividend * SCALE;
  const negative = (numerator < ZERO) !== (divisor < ZERO);
  const absoluteNumerator = numerator < ZERO ? -numerator : numerator;
  const absoluteDivisor = divisor < ZERO ? -divisor : divisor;
  const quotient = absoluteNumerator / absoluteDivisor;
  const remainder = absoluteNumerator % absoluteDivisor;
  const rounded = quotient + (remainder * BigInt(2) >= absoluteDivisor ? BigInt(1) : ZERO);
  return negative ? -rounded : rounded;
}

export function roundTo(value: bigint, decimalPlaces = 2): bigint {
  if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > DECIMAL_PLACES) {
    throw new Error("Currency decimal places must be between 0 and 8.");
  }
  const unit = powers[DECIMAL_PLACES - decimalPlaces];
  const negative = value < ZERO;
  const absolute = negative ? -value : value;
  const quotient = absolute / unit;
  const remainder = absolute % unit;
  const rounded = (quotient + (remainder * BigInt(2) >= unit ? BigInt(1) : ZERO)) * unit;
  return negative ? -rounded : rounded;
}

export function add(...values: bigint[]): bigint {
  return values.reduce((sum, value) => sum + value, ZERO);
}

export function subtract(left: bigint, right: bigint): bigint {
  return left - right;
}

export function compare(left: bigint, right: bigint): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function absolute(value: bigint): bigint {
  return value < ZERO ? -value : value;
}
