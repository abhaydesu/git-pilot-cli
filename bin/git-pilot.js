#!/usr/bin/env node
import { buildProgram, normalizeArgs } from "../src/cli.js";
import { handleError } from "../src/lib/ui.js";

try {
  const normalized = normalizeArgs(process.argv);
  await buildProgram().parseAsync(normalized);
} catch (err) {
  handleError(err);
}
