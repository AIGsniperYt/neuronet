import { readFile, writeFile } from "node:fs/promises";
import { migrateSubjectIdentity } from "../src/subjectModel.js";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("Usage: node scripts/migrate-dataset-v8.mjs <in.json> <out.json>");
const dataset = JSON.parse(await readFile(input, "utf8"));
const migrated = migrateSubjectIdentity(dataset);
await writeFile(output, `${JSON.stringify({ ...dataset, ...migrated, schemaVersion: 8 }, null, 2)}\n`);
