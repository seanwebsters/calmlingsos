import { z, type ZodType } from "zod";

type Json = Record<string, unknown>;
const DROP = ["$schema", "minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "pattern", "format", "default", "maxItems"];

/**
 * Zod → JSON Schema for provider structured-output modes. Constraints that
 * strict modes reject are moved into the description (and still enforced by
 * Zod when the output is parsed).
 */
export function toProviderSchema(schema: ZodType): Json {
  const raw = z.toJSONSchema(schema, { io: "output", unrepresentable: "any" }) as Json;
  return clean(raw);
}

function clean(node: unknown): Json {
  if (!node || typeof node !== "object" || Array.isArray(node)) return node as Json;
  const n = { ...(node as Json) };
  const notes: string[] = [];
  for (const k of DROP) {
    if (k in n) {
      const safeIntBound = typeof n[k] === "number" && Math.abs(n[k] as number) >= Number.MAX_SAFE_INTEGER;
      if (k !== "$schema" && k !== "default" && !safeIntBound) notes.push(`${k}: ${JSON.stringify(n[k])}`);
      delete n[k];
    }
  }
  if (typeof n.minItems === "number" && n.minItems > 1) {
    notes.push(`minItems: ${n.minItems}`);
    n.minItems = 1;
  }
  if (notes.length) n.description = [n.description, `(${notes.join(", ")})`].filter(Boolean).join(" ");
  if (n.type === "object" || n.properties) {
    if (n.properties || n.additionalProperties === undefined) n.additionalProperties = false;
    const props = (n.properties ?? {}) as Record<string, unknown>;
    n.properties = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, clean(v)]));
  }
  if (n.items) n.items = clean(n.items);
  for (const key of ["anyOf", "oneOf", "allOf"]) if (Array.isArray(n[key])) n[key] = (n[key] as unknown[]).map(clean);
  if (n.oneOf) {
    n.anyOf = n.oneOf;
    delete n.oneOf;
  }
  return n;
}
