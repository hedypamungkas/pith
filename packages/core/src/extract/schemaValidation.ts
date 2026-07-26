import { createRequire } from "node:module";
import { InvalidExtractionSchemaError } from "./extractionPort.js";

const requireModule = createRequire(import.meta.url);

// ajv's default import resolves to the module namespace under NodeNext (the
// same CJS-interop quirk as robots-parser); load via createRequire and type it
// minimally to what we use (compile + errorsText), without importing ajv's own
// types (which repeat the namespace issue).
type AjvCompiled = ((data: unknown) => boolean) & { errors?: unknown[] | null };
type AjvInstance = {
  compile: (schema: unknown) => AjvCompiled;
  errorsText: (errors?: unknown[] | null) => string;
};
const Ajv = requireModule("ajv") as new (opts?: object) => AjvInstance;
const ajv = new Ajv({ strict: false });

/**
 * Compiles a caller-provided JSON Schema, throwing InvalidExtractionSchemaError
 * on anything malformed. Shared by the route (so a bad schema is rejected with
 * a 400 before a page is even fetched) and the adapter (which reuses the
 * compiled validator to check the model's output against the same schema —
 * defense-in-depth, not a second source of truth).
 */
export function compileExtractionSchema(schema: Record<string, unknown>): AjvCompiled {
  try {
    return ajv.compile(schema);
  } catch (err) {
    throw new InvalidExtractionSchemaError(
      `schema is not a valid JSON Schema: ${(err as Error).message}`,
    );
  }
}

export { ajv };
