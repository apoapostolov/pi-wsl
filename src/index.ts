/**
 * Pi extension: run Linux in WSL without Git Bash / MSYS rewriting the command.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	bashInterceptReason,
	buildCommand,
	defaultDistro,
	DEFAULT_TIMEOUT_MS,
	formatDistrosList,
	formatStreams,
	interceptEnabled,
	inWsl,
	isDistrosAlias,
	killTree,
	listInstalledDistros,
	looksLikeMissingDistro,
	parsePathQuery,
	pathInterceptReason,
	resolveDistro,
	shellQuote,
	shouldRegister,
	toForwardUnc,
	toWslPath,
	toWslPathLive,
	type WslArgs,
	wakeDistro,
	withCdPrefix,
	wslExe,
	wslSupportsCd,
} from "./lib.ts";
import { renderWslCall, renderWslResult, type WslRenderState } from "./render.ts";

const parameters = Type.Object({
	command: Type.Optional(
		Type.String({
			description:
				"Raw bash to run inside WSL. Do not wrap in wsl -d or bash -lc. Paths should be Linux (/home/..., /mnt/c/...)",
		}),
	),
	script: Type.Optional(
		Type.String({
			description:
				"WSL or Windows path to a file to run. Accepts /home/..., /mnt/c/..., /c/..., C:\\..., \\\\wsl.localhost\\..., and the Git-Bash-eaten C:\\wsl.localhost\\... form. Runner is node/python3/bash from the extension",
		}),
	),
	args: Type.Optional(
		Type.Union([
			Type.Array(Type.String(), {
				description: "Arguments for script. Each item is quoted. Windows/UNC items are converted",
			}),
			Type.String({
				description: "Arguments for script as one string. Prefer the array form",
			}),
		]),
	),
	cwd: Type.Optional(
		Type.String({
			description: "Working directory. Windows, Git Bash /c/..., UNC, or Linux path. Converted to a WSL path. UNC cwd also selects that distro",
		}),
	),
	timeout: Type.Optional(
		Type.Number({
			description: "Timeout in seconds. Default 60",
		}),
	),
	distro: Type.Optional(
		Type.String({
			description:
				"WSL distro name. Default: this call's UNC cwd/script, then WSL_DISTRO, else the user's default distro",
		}),
	),
	env: Type.Optional(
		Type.Record(Type.String(), Type.String(), {
			description: "Extra environment variables inside WSL",
		}),
	),
	input: Type.Optional(
		Type.String({
			description: "Bytes written to the command's stdin. Use for long JS or nested quotes. Do not also put that payload in command",
		}),
	),
	login: Type.Optional(
		Type.Boolean({
			description: "Run bash -l. Default false. Use for profile-only setup",
		}),
	),
	userBus: Type.Optional(
		Type.Boolean({
			description: "Export XDG_RUNTIME_DIR and DBUS_SESSION_BUS_ADDRESS when unset. Default true. Needed for systemctl --user",
		}),
	),
	crlf: Type.Optional(
		Type.Boolean({ description: "Strip CRLF from script when present" }),
	),
	user: Type.Optional(Type.String({ description: "WSL user, such as root" })),
	background: Type.Optional(Type.Boolean({ description: "Start detached and return a PID and log path" })),
	log: Type.Optional(Type.String({ description: "Absolute output log path for background commands" })),
});

type Params = {
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
	user?: string;
	background?: boolean;
	log?: string;
};

type ChunkFn = (chunk: string, stream: "stdout" | "stderr") => void;

function spawnFileAndArgs(
	body: string,
	linuxCwd: string | undefined,
	distro: string | undefined,
	user: string | undefined,
	login: boolean,
	useStdinCommand: boolean,
	useCdFlag: boolean,
): { file: string; args: string[]; spawnCwd?: string } {
	const bashFlags = login ? ["-l"] : [];
	if (inWsl()) {
		return {
			file: "bash",
			args: useStdinCommand ? [...bashFlags, "-s"] : [...bashFlags, "-c", body],
			spawnCwd: linuxCwd,
		};
	}
	const args = [
		...(distro ? ["-d", distro] : []),
		...(user ? ["-u", user] : []),
		...(useCdFlag && linuxCwd ? ["--cd", linuxCwd] : []),
		"--",
		"bash",
		...bashFlags,
		...(useStdinCommand ? ["-s"] : ["-c", body]),
	];
	return { file: wslExe(), args };
}

async function runWsl(
	body: string,
	params: Params,
	timeoutMs: number,
	signal?: AbortSignal,
	onChunk?: ChunkFn,
): Promise<{
	code: number | null;
	stdout: string;
	stderr: string;
	killed: boolean;
	stopReason?: "abort" | "timeout";
	distro: string | undefined;
}> {
	if (params.user && !/^[A-Za-z_][A-Za-z0-9_.-]*\$?$/.test(params.user)) throw new Error("invalid WSL user");
	if (inWsl() && params.user) throw new Error("user selection requires Windows-hosted Pi");
	const distro = resolveDistro(params.distro, { cwd: params.cwd, script: params.script });
	await wakeDistro(distro);
	if (signal?.aborted) throw new Error("WSL command aborted before launch");
	const linuxCwd = await toWslPathLive(params.cwd, distro);
	const useCdFlag = Boolean(linuxCwd) && !inWsl() && await wslSupportsCd(distro);
	if (signal?.aborted) throw new Error("WSL command aborted before launch");
	const runBody = useCdFlag || inWsl() ? body : withCdPrefix(body, linuxCwd);
	const useStdinCommand = params.input == null;
	const { file, args, spawnCwd } = spawnFileAndArgs(
		runBody,
		linuxCwd,
		distro,
		params.user,
		Boolean(params.login),
		useStdinCommand,
		useCdFlag,
	);

	return new Promise((resolve, reject) => {
		if (!inWsl() && !existsSync(file)) {
			reject(new Error(`wsl.exe not found at ${file}. Install WSL, or set SystemRoot`));
			return;
		}
		const child = spawn(file, args, {
			cwd: spawnCwd,
			windowsHide: true,
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		let killed = false;
		let stopReason: "abort" | "timeout" | undefined;
		let stdoutDec = new StringDecoder("utf8");
		let stderrDec = new StringDecoder("utf8");
		let firstStdout = true;
		let firstStderr = true;
		const timer = setTimeout(() => {
			killed = true;
			stopReason = "timeout";
			killTree(child);
		}, timeoutMs);
		const onAbort = () => {
			killed = true;
			stopReason = "abort";
			killTree(child);
		};
		if (signal && typeof signal.addEventListener === "function") {
			signal.addEventListener("abort", onAbort, { once: true });
		}
		const take = (chunk: Buffer, stream: "stdout" | "stderr") => {
			const utf16 = chunk.subarray(1, Math.min(16, chunk.length)).some((byte) => byte === 0);
			if (stream === "stdout" && firstStdout) {
				if (utf16) stdoutDec = new StringDecoder("utf16le");
				firstStdout = false;
			} else if (stream === "stderr" && firstStderr) {
				if (utf16) stderrDec = new StringDecoder("utf16le");
				firstStderr = false;
			}
			const text = (stream === "stdout" ? stdoutDec : stderrDec).write(chunk).replace(/^\uFEFF/, "");
			if (!text) return;
			if (stream === "stdout") stdout += text;
			else stderr += text;
			onChunk?.(text, stream);
		};
		child.stdout?.on("data", (chunk) => take(chunk, "stdout"));
		child.stderr?.on("data", (chunk) => take(chunk, "stderr"));
		child.on("error", (err) => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			reject(err);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			const outTail = stdoutDec.end();
			const errTail = stderrDec.end();
			if (outTail) {
				stdout += outTail;
				onChunk?.(outTail, "stdout");
			}
			if (errTail) {
				stderr += errTail;
				onChunk?.(errTail, "stderr");
			}
			resolve({ code, stdout, stderr, killed, stopReason, distro });
		});
		const payload = useStdinCommand
			? runBody.endsWith("\n")
				? runBody
				: `${runBody}\n`
			: params.input ?? "";
		child.stdin?.on("error", (err: NodeJS.ErrnoException) => {
			if (err.code !== "EPIPE") reject(err);
		});
		child.stdin?.end(payload);
	});
}

function resultText(
	result: { code: number | null; stdout: string; stderr: string; killed: boolean; stopReason?: "abort" | "timeout"; distro?: string },
	cwd: string | undefined,
	timeoutMs: number,
	installedDistros?: string[],
): { text: string; truncated: boolean } {
	const streams = formatStreams(result.stdout, result.stderr);
	let extra = "";
	if (result.code !== 0 && looksLikeMissingDistro(result.stdout + result.stderr)) {
		extra = installedDistros?.length
			? `\ninstalled distros: ${installedDistros.join(", ")}`
			: "\nRun /wsl distros to list installed distros";
	}
	const header = [
		result.stopReason === "abort" ? "aborted" : result.stopReason === "timeout" ? `timed out after ${timeoutMs}ms` : `exit ${result.code ?? "?"}`,
		cwd ? `cwd ${toWslPath(cwd)}` : null,
		result.distro ? `distro ${result.distro}` : "distro default",
		streams.truncated ? "output truncated" : null,
	]
		.filter(Boolean)
		.join(" | ");
	return { text: `${header}\n${streams.text}${extra}`, truncated: streams.truncated };
}

export default function (pi: ExtensionAPI): void {
	if (!shouldRegister()) return;

	if (process.platform === "win32" && !inWsl() && interceptEnabled()) {
		pi.on("tool_call", (event) => {
			if (event.toolName === "wsl") return;
			const input = event.input as { command?: unknown; cwd?: unknown; path?: unknown };
			if (event.toolName === "bash" && typeof input.command === "string") {
				const reason = bashInterceptReason(
					input.command,
					typeof input.cwd === "string" ? input.cwd : undefined,
				);
				if (reason) return { block: true, reason };
			}
			if (
				(event.toolName === "read" || event.toolName === "write" || event.toolName === "edit") &&
				typeof input.path === "string"
			) {
				const reason = pathInterceptReason(input.path);
				if (reason) return { block: true, reason };
			}
		});
	}

	pi.registerTool({
		name: "wsl",
		label: "WSL",
		description: "Run Bash in WSL without Git Bash path and quote rewriting",
		promptSnippet: "Run Linux commands in WSL through wsl.exe",
		promptGuidelines: [
			"Use wsl for Linux paths, /mnt/c, or WSL UNC paths; pass the raw command without a wsl or bash -lc wrapper",
			"Use wsl script or input for long JS and nested quotes instead of one args string",
		],
		parameters,
		async execute(_toolCallId, params: Params, signal, onUpdate) {
			const cwd = params.cwd;
			const startedAt = Date.now();
			let lastChunkAt = startedAt;
			try {
				const timeoutSeconds = Number(params.timeout ?? DEFAULT_TIMEOUT_MS / 1000);
				if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 3600) throw new Error("timeout must be 1 to 3600 seconds");
				if (params.log && !params.background) throw new Error("log requires background: true");
				if (params.background && params.input != null) throw new Error("background commands cannot read input");
				const timeoutMs = timeoutSeconds * 1000;
				const body = buildCommand(params);
				let liveStdout = "";
				let liveStderr = "";
				let flushTimer: ReturnType<typeof setTimeout> | undefined;
				const liveDetails = () => ({
					cwd: toWslPath(cwd),
					distro: resolveDistro(params.distro, { cwd: params.cwd, script: params.script }) ?? null,
					stdout: liveStdout,
					stderr: liveStderr,
					unwrapped: body,
					startedAt,
					lastChunkAt,
				});
				const flush = () => {
					flushTimer = undefined;
					if (!onUpdate) return;
					onUpdate({
						content: [{ type: "text" as const, text: resultText({
							code: null,
							stdout: liveStdout,
							stderr: liveStderr,
							killed: false,
							distro: liveDetails().distro ?? undefined,
						}, cwd, timeoutMs).text }],
						details: liveDetails(),
					});
				};
				onUpdate?.({ content: [{ type: "text" as const, text: "" }], details: liveDetails() });
				const result = await runWsl(body, params, timeoutMs, signal, (chunk, stream) => {
					lastChunkAt = Date.now();
					if (stream === "stdout") liveStdout += chunk;
					else liveStderr += chunk;
					if (!onUpdate) return;
					if (!flushTimer) flushTimer = setTimeout(flush, 120);
				});
				if (flushTimer) clearTimeout(flushTimer);
				const installed = result.code !== 0 && looksLikeMissingDistro(result.stdout + result.stderr) ? await listInstalledDistros() : undefined;
				const rendered = resultText(result, cwd, timeoutMs, installed);
				const endedAt = Date.now();
				return {
					content: [{ type: "text" as const, text: rendered.text }],
					details: {
						code: result.code,
						killed: result.killed,
						cwd: toWslPath(cwd),
						distro: result.distro ?? null,
						stdout: result.stdout,
						stderr: result.stderr,
						unwrapped: body,
						stopReason: result.stopReason,
						startedAt,
						lastChunkAt,
						endedAt,
					},
					isError: result.killed || result.code !== 0,
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text" as const, text: `wsl tool failed: ${message}` }],
					details: { error: message, startedAt, lastChunkAt, endedAt: Date.now() },
					isError: true,
				};
			}
		},
		renderCall(args, theme, context) {
			return renderWslCall(args as Params, theme, context as WslRenderState & typeof context);
		},
		renderResult(result, options, theme, context) {
			return renderWslResult(
				result as { details?: import("./render.ts").WslRenderDetails; content?: Array<{ type: string; text?: string }> },
				options,
				theme,
				context as typeof context & { state: WslRenderState; args?: Params },
			);
		},
	});

	pi.registerCommand("wsl", {
		description: "Run in WSL, inspect status, list distros, or map a path",
		handler: async (args, ctx) => {
			const command = args.trim();
			if (!command) {
				ctx.ui.notify("Usage: /wsl <command> | /wsl status | /wsl distros | /wsl path <p> | /wsl job <pid> <log>", "error");
				return;
			}
			if (isDistrosAlias(command)) {
				const listed = await listInstalledDistros();
				ctx.ui.notify(formatDistrosList(listed), listed.length ? "info" : "error");
				return;
			}
			const jobQuery = command.match(/^job\s+(\d+)\s+(\/\S+)$/);
			if (jobQuery) {
				const [_, pid, log] = jobQuery;
				const result = await runWsl(`if kill -0 ${pid} 2>/dev/null; then echo 'Process: running'; else echo 'Process: stopped'; fi; tail -n 20 -- ${shellQuote(log)}`, { command, userBus: false }, DEFAULT_TIMEOUT_MS);
				ctx.ui.notify(result.stdout.trim() || result.stderr.trim(), result.code === 0 ? "info" : "error");
				return;
			}
			if (command === "status") {
				const distro = await defaultDistro();
				const result = await runWsl("printf 'Distro: %s\\n' \"${WSL_DISTRO_NAME:-unknown}\"; printf 'User: '; id -un; printf 'Systemd: '; systemctl is-system-running 2>/dev/null || true; printf 'Automount C: '; wslpath -u 'C:\\' 2>/dev/null || true; printf 'IP: '; hostname -I 2>/dev/null; printf 'WSL version: '; wsl.exe --version 2>/dev/null | head -1 | tr -d '\\r\\000'", { command: "status", distro, userBus: false }, DEFAULT_TIMEOUT_MS);
				ctx.ui.notify(result.stdout.trim() || result.stderr.trim(), result.code === 0 ? "info" : "error");
				return;
			}
			const pathQuery = parsePathQuery(command);
			if (pathQuery?.kind === "path-usage") {
				ctx.ui.notify("Usage: /wsl path <windows-or-unc-or-linux-path>", "error");
				return;
			}
			if (pathQuery?.kind === "path") {
				if (pathQuery.input.startsWith("/") && !/^\/[a-z](?:\/|$)/i.test(pathQuery.input)) {
					const distro = await defaultDistro();
					ctx.ui.notify(distro ? toForwardUnc(pathQuery.input, distro) : "Cannot resolve default WSL distro", distro ? "info" : "error");
				} else {
					const mapped = await toWslPathLive(pathQuery.input);
					ctx.ui.notify(mapped ?? pathQuery.input, "info");
				}
				return;
			}
			try {
				const result = await runWsl(
					command,
					{ command, cwd: ctx.cwd },
					DEFAULT_TIMEOUT_MS,
				);
				const installed = result.code !== 0 && looksLikeMissingDistro(result.stdout + result.stderr) ? await listInstalledDistros() : undefined;
				const rendered = resultText(result, ctx.cwd, DEFAULT_TIMEOUT_MS, installed);
				ctx.ui.notify(rendered.text, result.code === 0 ? "info" : "error");
			} catch (err) {
				ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
			}
		},
	});
}
