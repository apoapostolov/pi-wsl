/**
 * Path and command helpers for the wsl tool.
 *
 * Pi on Win11 invokes the builtin bash tool through Git Bash. MSYS rewrites
 * /mnt/c, eats $VARS, and turns \\wsl.localhost\DISTRO\... into
 * C:\wsl.localhost\DISTRO\... (MODULE_NOT_FOUND). This package spawn()s
 * System32\wsl.exe so Git Bash never sees the text.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";

export const DEFAULT_TIMEOUT_MS = 60_000;
export const MAX_CHARS = 50_000;
export const MAX_LINES = 2000;
export const STALL_WARN_MS = 15_000;

export type StreamMode = "both" | "stdout" | "stderr";

export function stallWarnMs(): number {
	const raw = Number(process.env.PI_WSL_STALL_WARN);
	if (Number.isFinite(raw) && raw > 0) return raw * 1000;
	return STALL_WARN_MS;
}

export function formatDuration(ms: number): string {
	return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}

export function isStalled(lastChunkAt: number | undefined, now: number, warnMs = stallWarnMs()): boolean {
	if (lastChunkAt == null) return false;
	return now - lastChunkAt >= warnMs;
}

export function nextStreamMode(mode: StreamMode): StreamMode {
	if (mode === "both") return "stdout";
	if (mode === "stdout") return "stderr";
	return "both";
}

export function lastNonEmptyLines(text: string, n: number): string {
	const lines = text.replace(/\s+$/u, "").split(/\r?\n/).filter((line) => line.length > 0);
	return lines.slice(-n).join("\n");
}

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

export function spinnerFrame(now: number, intervalMs = 120): string {
	const i = Math.floor(Math.max(0, now) / intervalMs) % SPINNER_FRAMES.length;
	return SPINNER_FRAMES[i];
}

export function prefixOutputLines(text: string, glyph: string): string[] {
	if (!text) return [];
	return text
		.replace(/\s+$/u, "")
		.split(/\r?\n/)
		.map((line) => (line.length ? `${glyph} ${line}` : glyph));
}

export function visibleLen(text: string): number {
	return text.replace(/\x1b\[[0-9;]*m/g, "").length;
}

/** Named distro replaces the WSL mark. Unset or "default" stays WSL. */
export function brandLabel(distro?: string | null): string {
	if (distro && distro !== "default") return distro;
	return "WSL";
}

export function padRow(left: string, right: string, width: number): string {
	const gap = width - visibleLen(left) - visibleLen(right);
	if (gap >= 1) return `${left}${" ".repeat(gap)}${right}`;
	const budget = Math.max(0, width - visibleLen(right) - 1);
	let clipped = left;
	while (visibleLen(clipped) > budget && clipped.length > 0) clipped = clipped.slice(0, -1);
	return budget > 0 ? `${clipped} ${right}`.trimEnd() : right.slice(0, Math.max(0, width));
}

const EATEN_UNC = /^[A-Za-z]:\/wsl(?:\.localhost|\$)\/([^/]+)(?:\/(.*))?$/i;
const UNC = /^\/\/wsl(?:\.localhost|\$)\/([^/]+)(?:\/(.*))?$/i;
const DRIVE = /^([A-Za-z]):\/(.*)$/;
const GIT_BASH_DRIVE = /^\/[a-z](?:\/|$)/i;
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type WslArgs = string | string[];
export type WslUnc = { distro: string; posixPath: string };

export type BuildParams = {
	command?: string;
	script?: string;
	args?: WslArgs;
	cwd?: string;
	timeout?: number;
	distro?: string;
	env?: Record<string, string>;
	input?: string;
	login?: boolean;
	userBus?: boolean;
	crlf?: boolean;
};

export type DistroHints = {
	cwd?: string;
	script?: string;
};

export function inWsl(): boolean {
	return Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP);
}

export function shouldRegister(): boolean {
	return process.platform === "win32" || inWsl();
}

export function wslExe(): string {
	return join(process.env.SystemRoot || "C:\\Windows", "System32", "wsl.exe");
}

export function normalizeSlashes(input: string): string {
	return stripLongPathPrefix(input.trim().replace(/\\/g, "/"));
}

/** \\?\C:\foo and //?/C:/foo → C:/foo */
export function stripLongPathPrefix(p: string): string {
	return p.replace(/^\/\/\?\/+/, "");
}

function linuxFromUncRest(rest: string | undefined): string {
	if (!rest) return "/";
	return `/${rest}`.replace(/\/{2,}/g, "/");
}

export function parseWslUnc(input: string | undefined): WslUnc | null {
	if (!input) return null;
	const p = normalizeSlashes(input);
	const eaten = p.match(EATEN_UNC);
	if (eaten) return { distro: eaten[1], posixPath: linuxFromUncRest(eaten[2]) };
	const unc = p.match(UNC);
	if (unc) return { distro: unc[1], posixPath: linuxFromUncRest(unc[2]) };
	return null;
}

/** Named distro: explicit param, then UNC cwd/script, then WSL_DISTRO, else default. */
export function resolveDistro(explicit?: string, hints?: DistroHints): string | undefined {
	const named = explicit?.trim();
	if (named) return named;
	const fromPath = parseWslUnc(hints?.cwd) || parseWslUnc(hints?.script);
	if (fromPath?.distro) return fromPath.distro;
	return process.env.WSL_DISTRO?.trim() || undefined;
}

export function toWslPath(input: string | undefined): string | undefined {
	if (!input) return undefined;
	const p = normalizeSlashes(input);
	const unc = parseWslUnc(p);
	if (unc) return unc.posixPath;
	const drive = p.match(DRIVE);
	if (drive) return `/mnt/${drive[1].toLowerCase()}/${drive[2]}`;
	if (GIT_BASH_DRIVE.test(p) && !p.startsWith("/mnt/")) return `/mnt${p}`;
	return p;
}

/** Windows path for wslpath -u. Drive letters and Git Bash /c/foo only. */
export function toWindowsPathForWslpath(input: string): string | undefined {
	const p = normalizeSlashes(input);
	if (parseWslUnc(p)) return undefined;
	const drive = p.match(DRIVE);
	if (drive) return `${drive[1].toUpperCase()}:\\${drive[2].replace(/\//g, "\\")}`;
	const git = p.match(/^\/([a-z])(?:\/(.*))?$/i);
	if (git && !p.startsWith("/mnt/")) {
		return `${git[1].toUpperCase()}:\\${(git[2] || "").replace(/\//g, "\\")}`;
	}
	return undefined;
}

export function wslpathUnix(windowsPath: string, distro?: string): string | undefined {
	try {
		const out = execFileSync(
			wslExe(),
			[...(distro ? ["-d", distro] : []), "--", "wslpath", "-u", windowsPath],
			{ timeout: 8000, windowsHide: true, encoding: "utf8" },
		);
		const line = String(out).trim().split(/\r?\n/)[0]?.trim();
		return line || undefined;
	} catch {
		return undefined;
	}
}

/** Like toWslPath, but drive letters go through wslpath -u when WSL is up. */
export function toWslPathLive(input: string | undefined, distro?: string): string | undefined {
	const mapped = toWslPath(input);
	if (!input || !mapped) return mapped;
	const windows = toWindowsPathForWslpath(input);
	if (!windows) return mapped;
	return wslpathUnix(windows, distro) || mapped;
}

export function withCdPrefix(body: string, linuxCwd: string | undefined): string {
	if (!linuxCwd) return body;
	return `cd -- ${shellQuote(linuxCwd)} && { ${body}\n}`;
}

let cdProbe: boolean | undefined;
export function wslSupportsCd(distro?: string): boolean {
	if (inWsl()) return false;
	if (cdProbe !== undefined) return cdProbe;
	try {
		execFileSync(
			wslExe(),
			[...(distro ? ["-d", distro] : []), "--cd", "/tmp", "--", "true"],
			{ timeout: 20000, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
		);
		cdProbe = true;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (looksLikeMissingDistro(msg)) {
			cdProbe = true;
		} else {
			cdProbe = !/--cd|unknown argument|invalid option/i.test(msg);
		}
	}
	return cdProbe;
}

let wokeDistro = false;
export function wakeDistro(distro?: string): void {
	if (wokeDistro || inWsl()) return;
	wokeDistro = true;
	try {
		execFileSync(wslExe(), [...(distro ? ["-d", distro] : []), "--", "true"], {
			timeout: 20000,
			windowsHide: true,
			stdio: "ignore",
		});
	} catch {
		// the real command will surface the error
	}
}

export function parsePathQuery(args: string): { kind: "path"; input: string } | { kind: "path-usage" } | null {
	const m = args.trim().match(/^path(?:\s+(.+))?$/i);
	if (!m) return null;
	const input = m[1]?.trim();
	if (!input) return { kind: "path-usage" };
	return { kind: "path", input };
}

export function looksLikeConvertiblePath(value: string): boolean {
	const p = normalizeSlashes(value);
	return Boolean(
		parseWslUnc(p) || DRIVE.test(p) || (GIT_BASH_DRIVE.test(p) && !p.startsWith("/mnt/")),
	);
}

/** Forward-slash UNC. Safer than \\wsl.localhost if something still hits Git Bash. */
export function toForwardUnc(linuxPath: string, distro: string): string {
	const rest = linuxPath.replace(/^\/+/, "");
	return `//wsl.localhost/${distro}/${rest}`;
}

export function runnerFor(scriptPath: string): string {
	if (/\.py$/i.test(scriptPath)) return "python3";
	if (/\.(mjs|cjs|js)$/i.test(scriptPath)) return "node";
	return "bash";
}

export function unwrapWslWrapper(command: string): string {
	let cmd = command.trim();
	cmd = cmd.replace(/^MSYS_NO_PATHCONV=1\s+/i, "");
	cmd = cmd.replace(/^wsl(?:\.exe)?\s+-d\s+\S+\s+--\s+/i, "");
	cmd = cmd.replace(/^wsl(?:\.exe)?\s+--\s+/i, "");
	const lc = cmd.match(/^bash\s+-lc\s+(["'])([\s\S]*)\1$/);
	if (lc) return lc[2];
	return cmd;
}

export function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function convertArg(value: string): string {
	if (!looksLikeConvertiblePath(value)) return value;
	return toWslPath(value) ?? value;
}

export function formatArgs(args: WslArgs | undefined): string {
	if (args == null) return "";
	if (typeof args === "string") {
		const t = args.trim();
		return t ? ` ${t}` : "";
	}
	if (args.length === 0) return "";
	return ` ${args.map((a) => shellQuote(convertArg(a))).join(" ")}`;
}

export function userBusPrefix(): string {
	return [
		`export XDG_RUNTIME_DIR="\${XDG_RUNTIME_DIR:-/run/user/\$(id -u)}"`,
		`export DBUS_SESSION_BUS_ADDRESS="\${DBUS_SESSION_BUS_ADDRESS:-unix:path=\${XDG_RUNTIME_DIR}/bus}"`,
	].join("; ");
}

export function envPrefix(env: Record<string, string> | undefined): string {
	if (!env) return "";
	const parts: string[] = [];
	for (const [key, value] of Object.entries(env)) {
		if (!ENV_KEY.test(key)) throw new Error(`invalid env name: ${key}`);
		parts.push(`export ${key}=${shellQuote(String(value))}`);
	}
	return parts.join("; ");
}

function scriptBody(linux: string, args: WslArgs | undefined, crlf: boolean): string {
	const extra = formatArgs(args);
	const runner = runnerFor(linux);
	const quoted = shellQuote(linux);
	if (!crlf) return `${runner} ${quoted}${extra}`;
	return [
		`_pi_wsl=$(mktemp /tmp/pi-wsl.XXXXXX)`,
		`cp -- ${quoted} "$_pi_wsl"`,
		`sed -i 's/\\r$//' "$_pi_wsl"`,
		`${runner} "$_pi_wsl"${extra}`,
		`rm -f "$_pi_wsl"`,
	].join(" && ");
}

export function buildCommand(params: BuildParams): string {
	const prefixes: string[] = [];
	if (params.userBus !== false) prefixes.push(userBusPrefix());
	const env = envPrefix(params.env);
	if (env) prefixes.push(env);

	let body: string;
	if (params.script) {
		const linux = toWslPath(params.script);
		if (!linux) throw new Error("script path is empty");
		body = scriptBody(linux, params.args, params.crlf !== false);
	} else {
		const command = params.command?.trim();
		if (!command) throw new Error("pass command or script");
		body = unwrapWslWrapper(command);
	}

	return [...prefixes, body].join("; ");
}

export function clip(text: string): { text: string; truncated: boolean } {
	const lines = text.split(/\r?\n/);
	let truncated = false;
	let out = text;
	if (lines.length > MAX_LINES) {
		out = lines.slice(-MAX_LINES).join("\n");
		truncated = true;
	}
	if (out.length > MAX_CHARS) {
		out = out.slice(-MAX_CHARS);
		truncated = true;
	}
	return { text: out, truncated };
}

export function formatStreams(stdout: string, stderr: string): { text: string; truncated: boolean } {
	const out = clip(stdout.replace(/\r\n/g, "\n"));
	const err = clip(stderr.replace(/\r\n/g, "\n"));
	const parts: string[] = [];
	if (out.text) parts.push(`--- stdout ---\n${out.text}`);
	if (err.text) parts.push(`--- stderr ---\n${err.text}`);
	return {
		text: parts.join("\n") || "(no output)",
		truncated: out.truncated || err.truncated,
	};
}

/** wsl.exe -l prints UTF-16LE on Windows. */
export function parseWslList(output: Buffer | string): string[] {
	const buffer = typeof output === "string" ? Buffer.from(output) : output;
	const utf16 =
		(buffer[0] === 0xff && buffer[1] === 0xfe) ||
		buffer.subarray(1, Math.min(16, buffer.length)).some((byte) => byte === 0);
	const text = utf16 ? buffer.toString("utf16le") : buffer.toString("utf8");
	return text
		.replace(/^\uFEFF/, "")
		.split(/\r?\n/)
		.map((s) => s.trim())
		.filter((s) => s && !s.toLowerCase().includes("noinstall") && !s.startsWith("Windows"));
}

export function listInstalledDistros(): string[] {
	try {
		const out = execFileSync(wslExe(), ["-l", "-q"], {
			timeout: 5000,
			windowsHide: true,
		});
		return parseWslList(out);
	} catch {
		return [];
	}
}

export function isDistrosAlias(args: string): boolean {
	return /^(distros?|list|-l)$/i.test(args.trim());
}

export function formatDistrosList(names: string[]): string {
	return names.length ? names.join("\n") : "No WSL distros found.";
}

export function looksLikeMissingDistro(stderr: string): boolean {
	return /there is no distribution|invalid distribution|does not exist/i.test(stderr);
}

export function interceptEnabled(): boolean {
	return process.env.PI_WSL_NO_INTERCEPT !== "true";
}

/** Label of a Git Bash rewrite risk in free text, or null. */
export function findRewriteRisk(text: string | undefined): string | null {
	if (!text) return null;
	const n = text.replace(/\\/g, "/");
	if (/MSYS_NO_PATHCONV/i.test(text)) return "MSYS_NO_PATHCONV";
	if (/wsl(?:\.localhost|\$)/i.test(n)) return "\\\\wsl.localhost";
	if (/[A-Za-z]:\/wsl/i.test(n)) return "C:\\\\wsl.localhost";
	if (/(?:^|[\s;|&])wsl(?:\.exe)?\s+(?:-d|--cd|--(?:\s|$))/i.test(text)) return "wsl.exe";
	if (/\/mnt\/[a-zA-Z](?:\/|$)/.test(n)) return "/mnt/<drive>";
	if (/(?:^|[\s"'`=])\/home\//.test(n)) return "/home/";
	return null;
}

export function bashInterceptReason(command: string, cwd?: string): string | null {
	const hit = findRewriteRisk(command) || findRewriteRisk(cwd);
	if (!hit) return null;
	return `Git Bash will rewrite ${hit}. Call the wsl tool with the raw command, and do not wrap it in wsl -d or bash -lc.`;
}

export function pathInterceptReason(path: string | undefined): string | null {
	if (!path) return null;
	const n = path.replace(/\\/g, "/");
	if (/wsl(?:\.localhost|\$)/i.test(n) || /[A-Za-z]:\/wsl/i.test(n)) {
		return "This path is a WSL UNC. Use the wsl tool to cat or write it, or pass a C:\\ path to read/write/edit.";
	}
	if (/\/mnt\/[a-zA-Z](?:\/|$)/.test(n)) {
		return "This path is /mnt/<drive>. Use the wsl tool, or pass a C:\\ path to read/write/edit.";
	}
	return null;
}

/** Kill the WSL/bash tree. SIGTERM on wsl.exe can leave the inner bash. */
export function killTree(child: ChildProcess): void {
	if (process.platform === "win32" && child.pid && !inWsl()) {
		spawn(join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"), [
			"/pid",
			String(child.pid),
			"/t",
			"/f",
		], {
			stdio: "ignore",
			windowsHide: true,
		}).unref();
	}
	try {
		child.kill("SIGTERM");
	} catch {
		// already gone
	}
}
