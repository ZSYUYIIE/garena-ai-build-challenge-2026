import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createDemoHistory } from "../src/history/demoHistory.js";

if (process.env.NODE_ENV === "production") {
  throw new Error("Dashboard demo data cannot be exported in production mode.");
}

const projectDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const outputPath = path.join(projectDirectory, "data", "dashboard-demo.json");
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const demo = createDemoHistory();
fs.writeFileSync(outputPath, `${JSON.stringify(demo, null, 2)}\n`, "utf8");
console.log(`Wrote ${demo.label} to ${outputPath}`);
console.log("This file is local and ignored by Git. It is never loaded unless demo mode is explicitly started.");
