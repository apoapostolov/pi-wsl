import { copyToClipboard, keyHint, rawKeyHint } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import {
	brandLabel,
	displayCommand,
	ellipsize,
	formatDuration,
	isStalled,
	nextStreamMode,
	padRow,
	prefixOutputLines,
	spinnerFrame,
	type StreamMode,
	toWslPath,
	visibleLen,
} from "./lib.ts";

export type WslRenderArgs = {
	command?: string;
	script?: string;
	cwd?: string;
	distro?: string;
};

export type WslRenderDetails = {
	code?: number | null;
	killed?: boolean;
	cwd?: string;
	distro?: string | null;
	stdout?: string;
	stderr?: string;
	unwrapped?: string;
	startedAt?: number;
	lastChunkAt?: number;
	endedAt?: number;
	error?: string;
};

export type WslRenderState = {
	startedAt?: number;
	endedAt?: number;
	interval?: ReturnType<typeof setInterval>;
	streamMode?: StreamMode;
	copied?: string;
};

type Theme = {
	fg: (name: string, text: string) => string;
	bold: (text: string) => string;
};

type CallContext = {
	state: WslRenderState;
	executionStarted?: boolean;
	isPartial?: boolean;
	isError?: boolean;
	invalidate: () => void;
};

type ResultContext = CallContext & {
	args?: WslRenderArgs;
};

export function headerTone(opts: {
	partial?: boolean;
	stalled?: boolean;
	killed?: boolean;
	code?: number | null;
	error?: boolean;
}): "success" | "error" | "warning" | "muted" {
	if (opts.error || opts.killed || (opts.code != null && opts.code !== 0)) return "error";
	if (opts.partial && opts.stalled) return "warning";
	if (opts.partial) return "muted";
	return "success";
}

export function headerStatus(opts: {
	partial?: boolean;
	stalled?: boolean;
	killed?: boolean;
	code?: number | null;
}): string {
	if (opts.partial) return opts.stalled ? "stalled" : "running";
	if (opts.killed) return "killed";
	if (opts.code == null) return "done";
	return `exit ${opts.code}`;
}

export function buildStatusRow(
	args: WslRenderArgs | undefined,
	details: WslRenderDetails | undefined,
	theme: Theme,
	now: number,
	partial: boolean,
	width: number,
): string {
	const brand = brandLabel(details?.distro ?? args?.distro);
	const startedAt = details?.startedAt;
	const lastChunkAt = details?.lastChunkAt ?? startedAt;
	const endedAt = details?.endedAt;
	const stalled = partial && isStalled(lastChunkAt, now);
	const status = headerStatus({
		partial,
		stalled,
		killed: details?.killed,
		code: details?.code,
	});
	const elapsedMs = startedAt != null ? (endedAt ?? now) - startedAt : undefined;
	const tone = headerTone({
		partial,
		stalled,
		killed: details?.killed,
		code: details?.code,
		error: Boolean(details?.error),
	});
	const mark = `${theme.fg("toolTitle", "⬢")} ${theme.bold(theme.fg("toolTitle", brand))}`;
	const right = [
		theme.fg(tone, status),
		elapsedMs != null ? theme.fg(stalled ? "warning" : "muted", formatDuration(elapsedMs)) : null,
	]
		.filter(Boolean)
		.join("  ");
	const cmd = displayCommand(args, details?.unwrapped);
	const inner = Math.max(20, width - 1);
	const cmdBudget = Math.max(0, inner - visibleLen(mark) - visibleLen(right) - 2);
	const shown = ellipsize(cmd, cmdBudget);
	const left = shown ? `${mark}  ${theme.fg("dim", shown)}` : mark;
	return padRow(left, right, inner);
}

export function displayLines(
	details: WslRenderDetails | undefined,
	mode: StreamMode,
	partial: boolean,
	now: number,
): string[] {
	const stdout = details?.stdout ?? "";
	const stderr = details?.stderr ?? "";
	const lines: string[] = [];
	if (mode === "stdout" || mode === "both") lines.push(...prefixOutputLines(stdout, ">"));
	if (mode === "stderr" || mode === "both") lines.push(...prefixOutputLines(stderr, "!"));
	if (lines.length === 0 && partial) lines.push(`> ${spinnerFrame(now)}`);
	else if (partial && lines.length > 0) {
		lines[lines.length - 1] = `${lines[lines.length - 1]} ${spinnerFrame(now)}`;
	}
	return lines;
}

function commandText(args: WslRenderArgs | undefined, details: WslRenderDetails | undefined): string {
	return displayCommand(args, details?.unwrapped);
}

export function renderWslCall(
	_args: WslRenderArgs | undefined,
	_theme: Theme,
	context: CallContext,
): { render: (width: number) => string[]; invalidate: () => void } {
	if (context.executionStarted && context.state.startedAt === undefined) {
		context.state.startedAt = Date.now();
	}
	return {
		render: () => [],
		invalidate() {},
	};
}

export function renderWslResult(
	result: { details?: WslRenderDetails; content?: Array<{ type: string; text?: string }> },
	options: { expanded: boolean; isPartial: boolean },
	theme: Theme,
	context: ResultContext,
): { handleInput?: (data: string) => void; render: (width: number) => string[]; invalidate: () => void } {
	const state = context.state;
	const details = result.details ?? {};
	if (context.executionStarted && state.startedAt === undefined) {
		state.startedAt = details.startedAt ?? Date.now();
	}
	if (options.isPartial && !state.interval) {
		state.interval = setInterval(() => context.invalidate(), 120);
	}
	if (!options.isPartial || context.isError) {
		state.endedAt ??= details.endedAt ?? Date.now();
		if (state.interval) {
			clearInterval(state.interval);
			state.interval = undefined;
		}
	}

	const mode = state.streamMode ?? "both";

	return {
		handleInput(data: string) {
			if (matchesKey(data, "s")) {
				state.streamMode = nextStreamMode(mode);
				context.invalidate();
				return;
			}
			if (matchesKey(data, "c")) {
				const text = details.unwrapped || context.args?.command || context.args?.script || "";
				if (text) {
					void copyToClipboard(text).then(() => {
						state.copied = "command";
						context.invalidate();
					});
				}
				return;
			}
			if (matchesKey(data, "p")) {
				const text = details.cwd || (context.args?.cwd ? toWslPath(context.args.cwd) : "") || "";
				if (text) {
					void copyToClipboard(text).then(() => {
						state.copied = "path";
						context.invalidate();
					});
				}
			}
		},
		render(width: number) {
			const now = Date.now();
			const merged = {
				...details,
				startedAt: details.startedAt ?? state.startedAt,
				endedAt: details.endedAt ?? state.endedAt,
			};
			const status = buildStatusRow(context.args, merged, theme, now, options.isPartial, width);
			let body = displayLines(details, mode, options.isPartial, now);
			if (!options.expanded && body.length > 3) body = body.slice(-3);
			const cmd = commandText(context.args, details);
			const inner = Math.max(20, width - 1);
			const cmdRight = ellipsize(cmd, Math.min(48, Math.max(8, Math.floor(inner * 0.4))));
			const lines = [status];
			body.forEach((line, i) => {
				const painted = theme.fg(line.startsWith("!") ? "warning" : "muted", line);
				const last = i === body.length - 1;
				if (last && cmdRight) {
					lines.push(padRow(painted, theme.fg("dim", cmdRight), inner));
				} else {
					lines.push(truncateToWidth(painted, inner));
				}
			});
			if (body.length === 0 && cmdRight) {
				lines.push(padRow(">", theme.fg("dim", cmdRight), inner));
			}
			const hints = [
				`${rawKeyHint("s", mode)}`,
				`${rawKeyHint("c", "copy cmd")}`,
				`${rawKeyHint("p", "copy cwd")}`,
				!options.expanded ? keyHint("app.tools.expand", "expand") : null,
				state.copied ? theme.fg("success", `copied ${state.copied}`) : null,
			].filter(Boolean);
			lines.push(truncateToWidth(theme.fg("dim", hints.join("  ")), width));
			return lines;
		},
		invalidate() {},
	};
}
