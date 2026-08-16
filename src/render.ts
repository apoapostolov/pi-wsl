import { copyToClipboard, keyHint, rawKeyHint } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import {
	brandLabel,
	formatDuration,
	formatStreams,
	isStalled,
	lastNonEmptyLines,
	nextStreamMode,
	padRow,
	type StreamMode,
	toWslPath,
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
	const distro = details?.distro ?? args?.distro;
	const brand = brandLabel(distro);
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
	const command = (details?.unwrapped || args?.command || args?.script || "").replace(/\s+/g, " ").trim();
	const left = `${theme.fg("toolTitle", "⬢")} ${theme.bold(theme.fg("toolTitle", brand))}${command ? `  ${theme.fg("dim", command)}` : ""}`;
	const right = [
		theme.fg(tone, status),
		elapsedMs != null ? theme.fg(stalled ? "warning" : "muted", formatDuration(elapsedMs)) : null,
	]
		.filter(Boolean)
		.join("  ");
	return padRow(left, right, Math.max(20, width));
}

function pickOutput(details: WslRenderDetails | undefined, mode: StreamMode): string {
	const stdout = details?.stdout ?? "";
	const stderr = details?.stderr ?? "";
	if (mode === "stdout") return stdout;
	if (mode === "stderr") return stderr;
	return formatStreams(stdout, stderr).text;
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
		state.interval = setInterval(() => context.invalidate(), 1000);
	}
	if (!options.isPartial || context.isError) {
		state.endedAt ??= details.endedAt ?? Date.now();
		if (state.interval) {
			clearInterval(state.interval);
			state.interval = undefined;
		}
	}

	const mode = state.streamMode ?? "both";
	const output =
		pickOutput(details, mode) ||
		(typeof result.content?.[0]?.text === "string" ? result.content[0].text : "");

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
			const merged = {
				...details,
				startedAt: details.startedAt ?? state.startedAt,
				endedAt: details.endedAt ?? state.endedAt,
			};
			const row = buildStatusRow(context.args, merged, theme, Date.now(), options.isPartial, width);
			const lines = [row];
			const body = options.expanded ? output : lastNonEmptyLines(output, 3);
			if (body) {
				for (const line of body.split("\n")) lines.push(truncateToWidth(theme.fg("muted", line), width));
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
