#!/usr/bin/env node
import { buildProgram } from "../src/cli.js";

await buildProgram().parseAsync(process.argv);
