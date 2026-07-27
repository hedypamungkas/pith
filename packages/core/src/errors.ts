/**
 * Thrown by engine entry points that have not been ported yet (spin-off steps
 * 2–3), and by `@use-pith/core/http` / `@use-pith/core/mcp` faces until step 3.
 */
export class NotImplementedError extends Error {
  constructor(feature: string) {
    super(`Not implemented yet: ${feature}. (Lands in spin-off step 3.)`);
    this.name = "NotImplementedError";
  }
}

/**
 * Thrown when a feature needs a configured backend that was not provided —
 * extraction/search have NO silent default (a billable endpoint must never be
 * assumed). Construct an engine with an explicit backend to clear it.
 */
export class NotConfiguredError extends Error {
  constructor(feature: string, hint?: string) {
    super(`${feature} is not configured.${hint ? ` ${hint}` : ""}`);
    this.name = "NotConfiguredError";
  }
}
