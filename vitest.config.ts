import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Vitest ran on bare defaults until now, which quietly meant any lib importing
 * through the `@/` alias could not be tested at all — the suite failed to
 * resolve the import before collecting a single test. Six libs are in that
 * state (velocity, unmatched-sales, market-prep, ticket-tailor/sync, and two
 * client helpers); market-prep is the first to need tests.
 *
 * The alias mirrors `paths` in tsconfig.json. Keep the two in step.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
