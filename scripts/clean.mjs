import fs from "node:fs";
import path from "node:path";

const targets = ["dist", ".cache", ".vite"];

for (const target of targets) {
  const fullPath = path.resolve(process.cwd(), target);
  if (!fs.existsSync(fullPath)) continue;
  fs.rmSync(fullPath, { recursive: true, force: true });
  console.log(`removed ${target}`);
}

console.log("Web clean completed.");
