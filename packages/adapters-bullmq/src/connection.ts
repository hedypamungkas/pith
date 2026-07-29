import { Redis } from "ioredis";
import type { RedisOptions } from "ioredis";

/**
 * A Redis connection as BullMQ accepts it: either connection options (BullMQ
 * creates and pools its own ioredis clients per Queue/Worker/QueueEvents) or an
 * existing ioredis instance the host already owns. The adapter never constructs
 * a client from env — the host passes it in (same ethos as the pg adapter's
 * `PgPoolQueryable(pool)`).
 */
export type QueueConnection = RedisOptions | Redis;

/**
 * The producer (Queue) side tolerates either form; pass it through unchanged.
 * (Queues only issue short request/response commands, so the default
 * `maxRetriesPerRequest` is fine.)
 */
export function normalizeQueueConnection(connection: QueueConnection): QueueConnection {
  return connection;
}

/**
 * Worker and QueueEvents connections issue BLOCKING commands, so BullMQ REQUIRES
 * `maxRetriesPerRequest: null` on them. If the host passed connection options we
 * set it here; if they passed an already-built ioredis instance, configuring it
 * is their responsibility (BullMQ will reject an instance that blocks).
 *
 * @see https://docs.bullmq.io/guide/connections
 */
export function normalizeBlockingConnection(
  connection: QueueConnection,
): QueueConnection {
  if (connection instanceof Redis) {
    // The adapter cannot mutate a host-owned instance, so a shared instance
    // MUST already be configured for BullMQ's blocking consumers. Reject a
    // misconfigured one with an actionable error rather than letting BullMQ
    // throw deep in Worker/QueueEvents construction
    // ("Your redis options maxRetriesPerRequest must be null").
    if (connection.options.maxRetriesPerRequest !== null) {
      throw new Error(
        "BullMqJobQueue/runWorkers: an ioredis instance used for a Worker or " +
          "QueueEvents must be created with `maxRetriesPerRequest: null` (a BullMQ " +
          "blocking-command requirement). Pass connection options instead and the " +
          "adapter will set it for you.",
      );
    }
    return connection;
  }
  return { ...connection, maxRetriesPerRequest: null };
}
