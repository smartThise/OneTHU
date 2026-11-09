export type Schema = Record<string, any>;
export { STU_ORIGIN, parseStuAuthEntry, validStuCallback, normalizeStuCallback } from '@onethu/gateway/stu-auth';
export { CAB_ORIGIN, parseCabAuthEntry, parseCabIdentity, normalizeCabCallback } from '@onethu/gateway/cab-auth';
export { DISCOVER_ORIGIN, DISCOVER_IDENTITY_URL, parseDiscoverLogin, normalizeDiscoverCallback } from '@onethu/gateway/discover-auth';
export { MYHOME_ORIGIN, MYHOME_IDENTITY_URL, normalizeMyhomeCallback } from '@onethu/gateway/myhome-auth';
export { SEAT_ORIGIN, SEAT_IDENTITY_URL, normalizeSeatCallback } from '@onethu/gateway/seat-auth';
export { THESIS_ORIGIN, THESIS_IDENTITY_URL, parseThesisLogin, normalizeThesisCallback } from '@onethu/gateway/thesis-auth';

/** Deliberately small JSON Schema subset shared by generated tuples and learn operations. */
export function validate(value: unknown, schema: Schema, path = "args", depth = 0): void {
  if (depth > 24) throw new Error(`INVALID_ARGUMENTS: ${path}: nesting limit`);
  if (schema.anyOf) {
    if (schema.anyOf.some((s: Schema) => { try { validate(value, s, path, depth + 1); return true; } catch { return false; } })) return;
    throw new Error(`INVALID_ARGUMENTS: ${path}: expected one of the documented types`);
  }
  if (schema.enum && !schema.enum.some((v: unknown) => v === value)) throw new Error(`INVALID_ARGUMENTS: ${path}: unexpected value`);
  if (schema.type === "string" && typeof value !== "string"
    || schema.type === "number" && (typeof value !== "number" || !Number.isFinite(value))
    || schema.type === "integer" && (typeof value !== "number" || !Number.isSafeInteger(value))
    || schema.type === "boolean" && typeof value !== "boolean") throw new Error(`INVALID_ARGUMENTS: ${path}: expected ${schema.type}`);
  if (schema.type === "array" && !Array.isArray(value)) throw new Error(`INVALID_ARGUMENTS: ${path}: expected array`);
  if (schema.type === "object" && (!value || typeof value !== "object" || Array.isArray(value))) throw new Error(`INVALID_ARGUMENTS: ${path}: expected object`);
  if (typeof value === "string" && (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? 100000))) throw new Error(`INVALID_ARGUMENTS: ${path}: invalid string length`);
  if (typeof value === "number" && (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))) throw new Error(`INVALID_ARGUMENTS: ${path}: outside allowed range`);
  if (typeof value === "string" && schema.pattern && !new RegExp(schema.pattern).test(value)) throw new Error(`INVALID_ARGUMENTS: ${path}: invalid format`);
  if (Array.isArray(value)) {
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? 10000)) throw new Error(`INVALID_ARGUMENTS: ${path}: wrong number of items`);
    value.forEach((item, index) => {
      const s = Array.isArray(schema.items) ? schema.items[index] : schema.items;
      if (!s && schema.additionalItems === false) throw new Error(`INVALID_ARGUMENTS: ${path}[${index}]: unexpected argument`);
      validate(item, s ?? {}, `${path}[${index}]`, depth + 1);
    });
  } else if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (!Object.hasOwn(obj, key)) throw new Error(`INVALID_ARGUMENTS: ${path}.${key}: required`);
    for (const key of Object.keys(obj)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error(`INVALID_ARGUMENTS: ${path}: reserved key`);
      const s = schema.properties?.[key];
      if (!s && schema.additionalProperties === false) throw new Error(`INVALID_ARGUMENTS: ${path}.${key}: unexpected property`);
      validate(obj[key], s ?? (typeof schema.additionalProperties === "object" ? schema.additionalProperties : {}), `${path}.${key}`, depth + 1);
    }
  }
}
