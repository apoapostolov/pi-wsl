/**
 * Pi extension: run Linux in WSL without Git Bash / MSYS rewriting the command.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	buildCommand,
	clip,
	DEFAULT_TIMEOUT_MS,
	inWsl,
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
				"WSL or Windows path to a file to run. Accepts /home/..., /mnt/c/..., C:\\..., \\\\wsl.localhost\\..., and the Git-Bash-eaten C:\\wsl.localhost\\... form. Runner is node/python3/bash from the extension",
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
			description: "Working directory. Windows or Linux path. Converted to a WSL path",
		}),
	),
	timeout: Type.Optional(
		Type.Number({
			description: "Timeout in seconds. Default 60",
		}),
	),
	distro: Type.Optional(
		Type.String({
			description: "WSL distro name. Default: WSL_DISTRO env, else the user's default distro",
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
): Promise<{
	code: number | null;
	stdout: string;
	stderr: string;
	killed: boolean;
}> {
	const distro = resolveDistro(params.distro);
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
		const timer = setTimeout(() => {
			killed = true;
			child.kill("SIGTERM");
		}, timeoutMs);
		const onAbort = () => {
			killed = true;
			child.kill("SIGTERM");
		};
		if (signal && typeof signal.addEventListener === "function") {
			signal.addEventListener("abort", onAbort, { once: true });
		}
		child.stdout?.on("data", (chunk) => {
			stdout += String(chunk);
		});
		child.stderr?.on("data", (chunk) => {
			stderr += String(chunk);
		});
		child.on("error", (err) => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			reject(err);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			resolve({ code, stdout, stderr, killed });
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
		async execute(_toolCallId, params: Params, signal) {
			const timeoutMs = Math.max(1, Number(params.timeout ?? DEFAULT_TIMEOUT_MS / 1000)) * 1000;
			const cwd = params.cwd;
			try {
				const body = buildCommand(params);
				const result = await runWsl(body, params, timeoutMs, signal);
				const combined = [result.stdout, result.stderr].filter(Boolean).join("");
				const clipped = clip(combined || "(no output)");
				const header = [
					result.killed ? `killed after ${timeoutMs}ms` : `exit ${result.code ?? "?"}`,
					cwd ? `cwd ${toWslPath(cwd)}` : null,
					resolveDistro(params.distro) ? `distro ${resolveDistro(params.distro)}` : "distro default",
					clipped.truncated ? "output truncated" : null,
				]
					.filter(Boolean)
					.join(" | ");
				return {
					content: [{ type: "text" as const, text: `${header}\n${clipped.text}` }],
					details: {
						code: result.code,
						killed: result.killed,
						cwd: toWslPath(cwd),
						distro: resolveDistro(params.distro) ?? null,
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
				const result = await runWsl(command, { command, cwd: ctx.cwd }, DEFAULT_TIMEOUT_MS);
				const clipped = clip(
					[result.stdout, result.stderr].filter(Boolean).join("") || "(no output)",
				);
				ctx.ui.notify(
					`exit ${result.code ?? "?"}\n${clipped.text}`,
					result.code === 0 ? "info" : "error",
				);
			} catch (err) {
				ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
			}
		},
	});
}
