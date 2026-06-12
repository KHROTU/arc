import { defineConfig } from "vitest/config";
import * as path from "node:path";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      // Allow tests to import source TS files using the `.js` import suffix.
      // We strip `.js` and add `.ts` so vitest can resolve the source.
      "^(\\.{1,2}\\/.*)\\.js$": "$1",
    },
  },
});
