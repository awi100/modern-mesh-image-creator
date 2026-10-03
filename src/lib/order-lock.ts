import { Prisma } from "@prisma/client";

/**
 * Serialise everything that touches one Shopify order's inventory.
 *
 * All three deduction paths (webhook, manual fulfil, sync) guarded themselves
 * with a read — "does this order already have line items / a fulfilledAt?" —
 * and then wrote. Under Postgres' default READ COMMITTED two concurrent runs
 * both see "not processed", both proceed, and the upsert resolves the clash
 * with ON CONFLICT DO UPDATE rather than erroring, so BOTH deduct. Shopify
 * retries `orders/fulfilled` whenever a delivery exceeds its 5s timeout, and
 * this handler makes ~10 sequential round trips to a remote DB inside the
 * transaction, so a delivery overlapping its own retry is routine. Three
 * confirmed double-deductions are in the OrderDeduction table (orders #3789 and
 * #3294), costing 3 kits and 3 canvases.
 *
 * An advisory lock rather than `SELECT … FOR UPDATE` because the ShopifyOrder
 * row usually does NOT exist yet on the first delivery — there is nothing to
 * lock. This keys on the order id itself, so the second caller waits at the
 * lock and then sees the committed state from the first.
 *
 * Transaction-scoped (`_xact_`): released automatically on commit OR rollback,
 * so a failed deduction can never strand the lock.
 *
 * Call this as the FIRST statement inside the transaction, before the
 * idempotency re-check — a check made before the lock is still a race.
 */
export async function lockOrder(
  tx: Prisma.TransactionClient,
  shopifyOrderId: string,
): Promise<void> {
  // hashtext() maps the id to the bigint the advisory lock API wants. Collisions
  // are harmless here: two unrelated orders sharing a hash would merely take the
  // lock in turn, which costs a little concurrency and changes no result.
  //
  // $executeRaw, NOT $queryRaw: pg_advisory_xact_lock returns void, and
  // $queryRaw tries to deserialise the result set, failing with "Failed to
  // deserialize column of type 'void'" — which would throw inside every
  // deduction transaction and take the whole path down.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${shopifyOrderId}))`;
}
