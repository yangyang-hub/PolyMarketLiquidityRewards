import { execFileSync, spawn } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";

export function packageBin(root, ...segments) {
  return resolve(root, "node_modules", ...segments);
}

export function runNode(root, args, label = `node ${args.join(" ")}`) {
  console.log(`\n> ${label}`);
  execFileSync(process.execPath, args, { cwd: root, stdio: "inherit" });
}

export function runNodeCli(root, name, cliPath, args = []) {
  assertCliExists(name, cliPath);
  console.log(`\n> ${name} ${args.join(" ")}`);
  execFileSync(process.execPath, [cliPath, ...args], { cwd: root, stdio: "inherit" });
}

export function spawnNodeCli(root, name, cliPath, args = [], env = {}) {
  assertCliExists(name, cliPath);
  console.log(`\n> ${name} ${args.join(" ")}`);
  return spawn(process.execPath, [cliPath, ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
}

function assertCliExists(name, cliPath) {
  if (!existsSync(cliPath)) {
    throw new Error(`未找到 ${name} CLI：${cliPath}。请先运行 npm install。`);
  }
}
