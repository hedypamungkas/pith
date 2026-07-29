import { Redis, type RedisOptions } from "ioredis";

/**
 * Real-Redis test handle (integration-real only). Mirrors the pg adapter's
 * `tests/helpers/pg.ts`: reads `REDIS_URL`, throws if absent. Returns connection
 * OPTIONS (not an instance) so both `BullMqJobQueue` and `runWorkers` can hand
 * them to BullMQ, which creates and pools its own clients per Queue/Worker/
 * QueueEvents (the recommended BullMQ usage; blocking consumers need their own
 * connections). A short-lived admin client backs `flushdb` for test isolation.
 */
export interface RedisHandle {
  /** Connection options for BullMQ (producer + workers). */
  readonly connection: RedisOptions;
  /** Drop all keys — isolate each test from BullMQ's `bull:*` state. */
  flushdb(): Promise<void>;
  close(): Promise<void>;
}

export async function redisFromEnv(): Promise<RedisHandle> {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error("REDIS_URL is not set (this is a real-Redis integration test).");
  }
  const parsed = new URL(url);
  const connection: RedisOptions = {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    // Workers/QueueEvents get maxRetriesPerRequest:null inside the adapter
    // (normalizeBlockingConnection); the producer doesn't need it.
    maxRetriesPerRequest: null,
  };
  const admin = new Redis(connection);
  return {
    connection,
    flushdb: async () => {
      await admin.flushdb();
    },
    close: async () => {
      await admin.quit();
    },
  };
}
