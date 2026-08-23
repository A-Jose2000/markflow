import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mobileRoot = path.join(repositoryRoot, "mobile");
const compilerPath = path.join(mobileRoot, "node_modules", "typescript", "bin", "tsc");

if (!existsSync(compilerPath)) {
  console.log("Mobile typecheck skipped: mobile dependencies are not installed.");
  process.exit(0);
}

const result = spawnSync(process.execPath, [compilerPath, "--noEmit", "-p", "tsconfig.json"], {
  cwd: mobileRoot,
  stdio: "inherit"
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
