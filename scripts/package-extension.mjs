import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const vsceCommand = process.platform === "win32" ? "vsce.cmd" : "vsce";

await run(npmCommand, ["run", "build"]);
await mkdir("package", { recursive: true });
await run(vsceCommand, ["package", "--no-dependencies", "--allow-missing-repository", "--out", "package"]);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`));
    });
  });
}
