/**
 * Which design a ticket's pick means.
 *
 * Resolution is recomputed on every sync and whenever a mapping changes, so it
 * is pure and takes the mappings as an argument rather than reading them.
 */

import { normaliseAnswer } from "./parse";

export type ResolveStatus = "override" | "mapped" | "ignored" | "unmapped" | "no_answer";

export interface MappingLike {
  answerKey: string;
  /** null means "this answer is not a canvas" — deliberately ignored, which is
   *  different from not having been mapped yet. */
  designId: string | null;
  needsKit: boolean;
}

export interface ResolvableTicket {
  canvasAnswer?: string | null;
  answerKey?: string | null;
  answerMasked?: boolean;
  overrideDesignId?: string | null;
}

export interface Resolution {
  designId: string | null;
  needsKit: boolean;
  status: ResolveStatus;
  /** True when the answer came back as "****" — an API key without
   *  customer-data access. Surfaced separately because it is a configuration
   *  failure, not an unrecognised canvas: left unflagged it looks like a pile
   *  of new designs to map. */
  masked: boolean;
}

export function mappingsByKey(mappings: MappingLike[]): Map<string, MappingLike> {
  const m = new Map<string, MappingLike>();
  for (const x of mappings) m.set(normaliseAnswer(x.answerKey), x);
  return m;
}

/**
 * An override always wins: someone swapped canvases at the table, and what
 * physically left is what we deduct. The original answer is kept on the ticket
 * either way.
 *
 * Every sip-and-stitch canvas goes out kitted, so needsKit defaults true and
 * only a mapping row can turn it off.
 */
export function resolveTicket(
  ticket: ResolvableTicket,
  byKey: Map<string, MappingLike>,
): Resolution {
  const masked = ticket.answerMasked === true;

  if (ticket.overrideDesignId) {
    return { designId: ticket.overrideDesignId, needsKit: true, status: "override", masked };
  }

  const key = normaliseAnswer(ticket.answerKey ?? ticket.canvasAnswer);
  if (!key) return { designId: null, needsKit: true, status: "no_answer", masked };

  // A masked answer must never be treated as an answer. Without this it would
  // become a single "****" mapping row that silently absorbs every ticket.
  if (masked) return { designId: null, needsKit: true, status: "unmapped", masked };

  const mapping = byKey.get(key);
  if (!mapping) return { designId: null, needsKit: true, status: "unmapped", masked };
  if (mapping.designId === null) return { designId: null, needsKit: false, status: "ignored", masked };

  return { designId: mapping.designId, needsKit: mapping.needsKit, status: "mapped", masked };
}
