#!/usr/bin/env node
import { resolve } from "node:path";

import { createCosystemProject } from "./index.js";

const target = process.argv[2] ?? "cosystem-app";
const root = resolve(process.cwd(), target);

await createCosystemProject({
  name: target,
  root,
});

console.log(`Created CoSystem project at ${root}`);
