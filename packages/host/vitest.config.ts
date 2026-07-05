import { defineConfig } from "vitest/config";
import * as path from "node:path";
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "^(\\.{1,2}\\/.*)\\.js$": "$1",
    },
  },
});