import { helper } from "./utils";
import { readFileSync } from "node:fs";
import type { UnusedImport } from "unused-module";

const data = readFileSync("./playground/data/sample.json", "utf-8");
const parsed = JSON.parse(data);

function greet(name: string): string {
  return `Hello, ${name}! The config says: ${helper()}`;
}

const result: number = greet("Arc");

console.log(result);
