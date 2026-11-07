/**
 * Read-only Ticket Tailor probe, for checking the key and seeing what an event
 * actually holds without touching the database.
 *
 *   export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"
 *   npx tsx --tsconfig tsconfig.json scripts/tt-probe.ts            # all events
 *   npx tsx --tsconfig tsconfig.json scripts/tt-probe.ts ev_9365960 # one event
 *
 * Needs TICKET_TAILOR_API_KEY in the environment. GET only — this script, like
 * the client it uses, has no way to write to Ticket Tailor.
 */

import { listEvents, listIssuedTickets, listOrders } from "../src/lib/ticket-tailor/client";
import { parseEvent, parseIssuedTicket, parseOrder } from "../src/lib/ticket-tailor/parse";

async function main() {
  const wanted = process.argv.find((a) => a.startsWith("ev_"));

  const events = (await listEvents()).map(parseEvent).sort(
    (a, b) => (a.startsAt?.getTime() ?? 0) - (b.startsAt?.getTime() ?? 0),
  );
  console.log(`${events.length} events\n`);
  for (const e of events) {
    console.log(
      `  ${e.startsAt?.toISOString().slice(0, 10) ?? "????-??-??"}  ${e.ttEventId}  ` +
      `${(e.ttStatus ?? "").padEnd(12)} ${e.name}  @ ${e.venueName ?? "?"}`,
    );
  }

  for (const e of events) {
    if (wanted && e.ttEventId !== wanted) continue;
    if (!wanted && (e.ttStatus === "draft")) continue;

    const tickets = (await listIssuedTickets(e.ttEventId)).map(parseIssuedTicket);
    const orders = (await listOrders(e.ttEventId)).map(parseOrder);
    const answered = tickets.filter((t) => t.canvasAnswer);
    const masked = tickets.filter((t) => t.answerMasked);

    console.log(`\n=== ${e.name} (${e.ttEventId}) ===`);
    console.log(`  ${orders.length} orders, ${tickets.length} tickets`);
    console.log(`  answered ${answered.length}, no answer ${tickets.length - answered.length}, voided ${tickets.filter((t) => t.voidedAt).length}`);
    if (masked.length) {
      // The one failure that looks like data and is really configuration.
      console.log(`  *** ${masked.length} MASKED answers — the API key cannot read customer data ***`);
    }
    const byAnswer = new Map<string, number>();
    for (const t of answered) byAnswer.set(t.canvasAnswer!, (byAnswer.get(t.canvasAnswer!) ?? 0) + 1);
    for (const [a, n] of [...byAnswer.entries()].sort((x, y) => y[1] - x[1])) {
      console.log(`     ${String(n).padStart(3)}  ${a}`);
    }
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
