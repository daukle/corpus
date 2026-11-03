import { spawn, spawnSync } from "node:child_process";
import { openSync, closeSync, writeSync } from "node:fs";

export interface Finished {
  code: number | null;
  timedOut: boolean;
  seconds: number;
}

export interface RunOptions {
  cwd: string;
  log: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
}

const IS_WINDOWS = process.platform === "win32";

function quoted(argument: string): string {
  return /[\s"&|<>^()]/.test(argument) ? `"${argument.replaceAll('"', '\\"')}"` : argument;
}

/** @implNote a timeout on Windows must end the whole tree: killing the shell leaves a Gradle JVM running. */
function killTree(pid: number): void {
  if (IS_WINDOWS) {
    spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)], { stdio: "ignore" });
  } else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // the group is already gone
    }
  }
}

/**
 * Runs with stdin closed, because a Gradle client forwarding a stdin that never ends hung a
 * daemon for hours (daukle TRAPS.md, 2026-11-01). Output is appended to options.log.
 */
export function run(command: string, args: string[], options: RunOptions): Promise<Finished> {
  const log = openSync(options.log, "a");
  writeSync(log, `\n$ ${[command, ...args].join(" ")}   (in ${options.cwd})\n`);
  const started = Date.now();
  const child = IS_WINDOWS
    ? spawn([command, ...args].map(quoted).join(" "), [], {
        cwd: options.cwd, env: options.env ?? process.env, stdio: ["ignore", log, log], shell: true, windowsHide: true,
      })
    : spawn(command, args, { cwd: options.cwd, env: options.env ?? process.env, stdio: ["ignore", log, log], detached: true });
  return new Promise((resolve) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid !== undefined) killTree(child.pid);
    }, options.timeoutMs);
    const finish = (code: number | null): void => {
      clearTimeout(timer);
      closeSync(log);
      resolve({ code, timedOut, seconds: Math.round((Date.now() - started) / 1000) });
    };
    child.on("error", () => finish(null));
    child.on("exit", (code) => finish(code));
  });
}

/** Captures stdout, for short commands whose answer is their output. */
export function capture(command: string, args: string[], cwd: string): { code: number | null; stdout: string; stderr: string } {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 });
  return { code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** Ends every JVM whose executable lives under directory: the Gradle daemons a daukle cache provisioned. */
export function stopJvmsUnder(directory: string): void {
  if (IS_WINDOWS) {
    const windowsPath = directory.replaceAll("/", "\\").replaceAll("'", "''");
    const script = `Get-CimInstance Win32_Process -Filter "Name='java.exe'" | `
      + `Where-Object { $_.ExecutablePath -like '${windowsPath}*' } | `
      + `ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
    spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: "ignore" });
  } else {
    spawnSync("pkill", ["-f", directory], { stdio: "ignore" });
  }
}
