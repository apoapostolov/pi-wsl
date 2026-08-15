/**
 * Pi extension: run Linux in WSL without Git Bash / MSYS rewriting the command.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	buildCommand,
	DEFAULT_TIMEOUT_MS,
	formatStreams,
	inWsl,
	killTree,
	listInstalledDistros,
	looksLikeMissingDistro,
	resolveDistro,
	shouldRegister,
	toWslPath,
	type WslArgs,
	wslExe,
} from "./lib.ts";

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
		Type.Boolean({
			description: "When script is set, copy to /tmp and strip CR. Default true. Does not mutate the original file",
		}),
	),
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
};

type ChunkFn = (chunk: string, stream: "stdout" | "stderr") => void;

function spawnFileAndArgs(
	body: string,
	cwd: string | undefined,
	distro: string | undefined,
	login: boolean,
	useStdinCommand: boolean,
): { file: string; args: string[]; spawnCwd?: string } {
	const linuxCwd = toWslPath(cwd);
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
		...(linuxCwd ? ["--cd", linuxCwd] : []),
		"--",
		"bash",
		...bashFlags,
		...(useStdinCommand ? ["-s"] : ["-c", body]),
	];
	return { file: wslExe(), args };
}

function runWsl(
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
	distro: string | undefined;
}> {
	const distro = resolveDistro(params.distro, { cwd: params.cwd, script: params.script });
	const useStdinCommand = params.input == null;
	const { file, args, spawnCwd } = spawnFileAndArgs(
		body,
		params.cwd,
		distro,
		Boolean(params.login),
		useStdinCommand,
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
		const stdoutDec = new StringDecoder("utf8");
		const stderrDec = new StringDecoder("utf8");
		const timer = setTimeout(() => {
			killed = true;
			killTree(child);
		}, timeoutMs);
		const onAbort = () => {
			killed = true;
			killTree(child);
		};
		if (signal && typeof signal.addEventListener === "function") {
			signal.addEventListener("abort", onAbort, { once: true });
		}
		const take = (chunk: Buffer, decoder: StringDecoder, stream: "stdout" | "stderr") => {
			const text = decoder.write(chunk);
			if (!text) return;
			if (stream === "stdout") stdout += text;
			else stderr += text;
			onChunk?.(text, stream);
		};
		child.stdout?.on("data", (chunk) => take(chunk, stdoutDec, "stdout"));
		child.stderr?.on("data", (chunk) => take(chunk, stderrDec, "stderr"));
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
			resolve({ code, stdout, stderr, killed, distro });
		});
		const payload = useStdinCommand
			? body.endsWith("\n")
				? body
				: `${body}\n`
			: params.input ?? "";
		child.stdin?.write(payload);
		child.stdin?.end();
	});
}

function resultText(
	result: { code: number | null; stdout: string; stderr: string; killed: boolean; distro?: string },
	cwd: string | undefined,
	timeoutMs: number,
): { text: string; truncated: boolean } {
	const streams = formatStreams(result.stdout, result.stderr);
	let extra = "";
	if (result.code !== 0 && looksLikeMissingDistro(result.stderr)) {
		const listed = listInstalledDistros();
		if (listed.length) extra = `\ninstalled distros: ${listed.join(", ")}`;
	}
	const header = [
		result.killed ? `killed after ${timeoutMs}ms` : `exit ${result.code ?? "?"}`,
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

	pi.registerTool({
		name: "wsl",
		label: "WSL",
		description:
			"Run a command in WSL by spawn()ing wsl.exe. Prefer this over bash for Linux paths, /mnt/c, and \\\\wsl.localhost. Git Bash rewrites those and breaks node/python. Pass command, or script plus args. Do not wrap in wsl -d or bash -lc",
		promptSnippet: "Run Linux in WSL without Git Bash rewriting /mnt/c, UNC, or $VARS",
		promptGuidelines: [
			"Use the wsl tool instead of bash when the work is in WSL, /mnt/c, \\\\wsl.localhost, or a Linux home path",
			"Never pass \\\\wsl.localhost paths to the bash tool. Git Bash rewrites them to C:\\\\wsl.localhost\\\\... and node dies MODULE_NOT_FOUND",
			"Do not wrap a wsl tool call in wsl -d or bash -lc. Pass the raw command, or script plus an args array",
			"Put long JS or nested quotes in script, or in input with a short command. A single args string around eval JS still splits wrong",
			"systemctl --user needs the wsl tool userBus default, or login true. A non-login bash has no user D-Bus",
		],
		parameters,
		async execute(_toolCallId, params: Params, signal, onUpdate) {
			const timeoutMs = Math.max(1, Number(params.timeout ?? DEFAULT_TIMEOUT_MS / 1000)) * 1000;
			const cwd = params.cwd;
			try {
				const body = buildCommand(params);
				let preview = "";
				let flushTimer: ReturnType<typeof setTimeout> | undefined;
				const flush = () => {
					flushTimer = undefined;
					if (!onUpdate || !preview) return;
					onUpdate({ content: [{ type: "text" as const, text: preview }], details: {} });
				};
				const result = await runWsl(body, params, timeoutMs, signal, (chunk) => {
					preview += chunk;
					if (!onUpdate) return;
					if (!flushTimer) flushTimer = setTimeout(flush, 120);
				});
				if (flushTimer) clearTimeout(flushTimer);
				const rendered = resultText(result, cwd, timeoutMs);
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
					},
					isError: result.killed || result.code !== 0,
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text" as const, text: `wsl tool failed: ${message}` }],
					details: { error: message },
					isError: true,
				};
			}
		},
	});

	pi.registerCommand("wsl", {
		description: "Run a one-liner in WSL (no Git Bash rewrite)",
		handler: async (args, ctx) => {
			const command = args.trim();
			if (!command) {
				ctx.ui.notify("Usage: /wsl <command>", "error");
				return;
			}
			try {
				const result = await runWsl(
					command,
					{ command, cwd: ctx.cwd },
					DEFAULT_TIMEOUT_MS,
				);
				const rendered = resultText(result, ctx.cwd, DEFAULT_TIMEOUT_MS);
				ctx.ui.notify(rendered.text, result.code === 0 ? "info" : "error");
			} catch (err) {
				ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
			}
		},
	});
}
