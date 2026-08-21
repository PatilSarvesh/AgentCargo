import { spawn } from "node:child_process";
import { addConfiguredPort } from "../build/port-config.mjs";

const [command, ...rawArgs] = process.argv.slice(2);
if (!new Set(["dev", "start", "build"]).has(command)) {
  console.error("Usage: run-vinext.mjs <dev|start|build> [args]");
  process.exit(2);
}

const args = command === "build"
  ? rawArgs
  : addConfiguredPort(rawArgs, process.env.AGENTCARGO_WEB_PORT);
const executable = process.platform === "win32" ? "vinext.cmd" : "vinext";
const child = spawn(executable, [command, ...args], {
  env: process.env,
  shell: process.platform === "win32",
  stdio: "inherit",
});

child.once("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
child.once("exit", (code, signal) => {
  if (signal) {
    console.error(`vinext ${command} exited with signal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
