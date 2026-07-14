// Launch the built WoW Companion desktop app.
//
// Runs the release binary produced by `npm run build:exe` (Tauri's
// `cargo build --release` output), detached from this process so the app keeps
// running after the terminal closes. Run `npm run app` to rebuild + launch, or
// `npm run launch` to start the last build.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Cargo names the binary after the package (`wow-companion`), not the Tauri
// productName. Windows appends `.exe`.
const BIN_NAME = "wow-companion";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const exeName = process.platform === "win32" ? `${BIN_NAME}.exe` : BIN_NAME;
const exePath = join(repoRoot, "src-tauri", "target", "release", exeName);

if (!existsSync(exePath)) {
  console.error(`Executable not found: ${exePath}`);
  console.error("Build it first:  npm run build:exe   (or `npm run app` to build + launch)");
  process.exit(1);
}

// Detach so closing this shell doesn't take the app down with it.
const child = spawn(exePath, [], { detached: true, stdio: "ignore" });
child.on("error", (err) => {
  console.error(`Failed to launch ${exeName}: ${err.message}`);
  process.exit(1);
});
child.unref();

console.log(`Launched ${exeName} (pid ${child.pid}). Close its window to stop.`);
