// Input validation utilities

export function isNonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim().length > 0;
}

export function isValidEmail(val: unknown): val is string {
  if (typeof val !== "string") return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
}

export function isPositiveNumber(val: unknown): val is number {
  return typeof val === "number" && val > 0 && Number.isFinite(val);
}

export function isNonNegativeNumber(val: unknown): val is number {
  return typeof val === "number" && val >= 0 && Number.isFinite(val);
}

export function isPositiveInteger(val: unknown): val is number {
  return typeof val === "number" && Number.isInteger(val) && val > 0;
}

export function isNonNegativeInteger(val: unknown): val is number {
  return typeof val === "number" && Number.isInteger(val) && val >= 0;
}

export function isValidEnum<T extends string>(val: unknown, values: readonly T[]): val is T {
  return typeof val === "string" && values.includes(val as T);
}

export function isArray(val: unknown): val is unknown[] {
  return Array.isArray(val);
}

export function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

export interface ValidationError {
  field: string;
  message: string;
}

export function validate(rules: Array<[boolean, string, string]>): ValidationError[] {
  return rules
    .filter(([valid]) => !valid)
    .map(([, field, message]) => ({ field, message }));
}
