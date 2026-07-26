import type { BrowserContextOptions } from "playwright";

/**
 * A Playwright storage state (cookies + per-origin localStorage/sessionStorage),
 * the shape the headless tier accepts and the session cipher encrypts at rest.
 * Defined once here so the fetch tier and the crypto tier share the type
 * without either depending on the other.
 *
 * Type-only (erased at runtime); `playwright` is an optional peer — consumers
 * who never touch the headless tier or authenticated sessions don't need it.
 */
export type StorageState = Exclude<
  BrowserContextOptions["storageState"],
  string | undefined
>;
