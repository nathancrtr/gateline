#!/usr/bin/env node
// ads-core — npx front door for the framework's integration tool.
//
// The payload is scripts/integrate.py (stdlib Python, the same file the
// framework vendors into host repos); this shim only locates a Python 3
// interpreter and hands over. For `validate` and `fork` inside an integrated
// host repo, the vendored copy is preferred over the bundled one, so the
// host's pinned version stays authoritative (INTEGRATION.md §8).
"use strict";
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function findPython() {
  const candidates = process.platform === "win32"
    ? [["py", ["-3"]], ["python3", []], ["python", []]]
    : [["python3", []], ["python", []]];
  for (const [cmd, baseArgs] of candidates) {
    const probe = spawnSync(cmd, baseArgs.concat(["--version"]), { encoding: "utf8" });
    if (probe.status === 0 && /Python 3\./.test(probe.stdout + probe.stderr)) {
      return [cmd, baseArgs];
    }
  }
  console.error(
    "ads-core: no Python 3 interpreter found on PATH.\n" +
    "The framework's tooling is stdlib-only Python 3.9+ — install Python 3\n" +
    "(https://www.python.org/downloads/) and re-run."
  );
  process.exit(1);
}

function vendoredScript(args) {
  // Only redirect subcommands that operate on an already-integrated host.
  if (!["validate", "fork"].includes(args[0])) return null;
  let prefix = ".agentic";
  const flag = args.indexOf("--prefix");
  if (flag !== -1 && args[flag + 1]) prefix = args[flag + 1];
  const lockPath = path.join(process.cwd(), prefix, "framework-lock.json");
  if (!fs.existsSync(lockPath)) return null;
  let lock;
  try {
    lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  } catch (err) {
    return null; // malformed lock: let the bundled tool report it properly
  }
  const scriptRoot = lock.layout === "prefixed" ? path.join(prefix, "scripts") : "scripts";
  const vendored = path.join(process.cwd(), scriptRoot, "integrate.py");
  return fs.existsSync(vendored) ? vendored : null;
}

const args = process.argv.slice(2);
const [python, pythonArgs] = findPython();
const script =
  vendoredScript(args) || path.join(__dirname, "..", "scripts", "integrate.py");
const result = spawnSync(python, pythonArgs.concat([script]).concat(args), {
  stdio: "inherit",
});
process.exit(result.status === null ? 1 : result.status);
