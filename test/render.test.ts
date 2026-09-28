import assert from "node:assert/strict";
import { test } from "node:test";
import { renderWslResult, buildStatusRow, headerStatus, type WslRenderState } from "../src/render.ts";
import { visibleLen } from "../src/lib.ts";

function themeLike() {
	return {
		fg: (_name: string, text: string) => text,
		bold: (text: string) => text,
		bg: (name: string, text: string) => {
			throw new Error(`Unknown theme background color: ${name}`);
		},
	};
}

function ansiTheme() {
	return {
		fg: (_name: string, text: string) => `\x1b[38;5;42m${text}\x1b[0m`,
		bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
		bg: (name: string, text: string) => {
			throw new Error(`Unknown theme background color: ${name}`);
		},
	};
}

test("abort and timeout have distinct status", () => {
	assert.equal(headerStatus({ killed: true, stopReason: "abort" }), "aborted");
	assert.equal(headerStatus({ killed: true, stopReason: "timeout" }), "timed out");
});

test("status rows fit the terminal when the command contains wide Unicode", () => {
	const row = buildStatusRow(
		{ command: "for i in 1 2 3; do printf '第%s次: ' \\\"$i\\\"; done" },
		{ code: null, startedAt: 0, lastChunkAt: 0 },
		themeLike(),
		1_000,
		true,
		30,
	);
	assert.ok(visibleLen(row) <= 29, `${visibleLen(row)} > 29: ${row}`);
});

test("renderWslResult truncates wide and ANSI output to the terminal width", () => {
	const state: WslRenderState = {};
	const view = renderWslResult(
		{ details: { stdout: "😀😀😀😀", code: 0, startedAt: 1, endedAt: 2 } },
		{ expanded: false, isPartial: false },
		themeLike(),
		{ state, invalidate() {}, executionStarted: true, args: { command: "echo 第一次" } },
	);
	const lines = view.render(10);
	assert.ok(lines.every((line) => visibleLen(line) <= 9), lines.map(visibleLen));
});

test("renderWslResult keeps every ANSI-styled line within narrow widths", () => {
	const state: WslRenderState = {};
	const view = renderWslResult(
		{
			details: {
				stdout: "\x1b[35m第一个结果 😀😀😀\x1b[0m",
				stderr: "\x1b[31m错误信息\x1b[0m",
				code: 1,
				startedAt: 1,
				endedAt: 2,
			},
		},
		{ expanded: true, isPartial: false },
		ansiTheme(),
		{ state, invalidate() {}, executionStarted: true, args: { command: "printf 第一次 😀" } },
	);
	for (const width of [1, 2, 3, 4, 5, 8, 10, 30, 166]) {
		const lines = view.render(width);
		assert.ok(lines.every((line) => visibleLen(line) <= width), `width ${width}: ${lines.map(visibleLen)}`);
	}
});

test("renderWslResult last line is output, not an expand chip", () => {
	const state: WslRenderState = {};
	const view = renderWslResult(
		{ details: { stdout: "hello\nworld\n", code: 0, startedAt: 1, endedAt: 2 } },
		{ expanded: false, isPartial: false },
		themeLike(),
		{ state, invalidate() {}, executionStarted: true, args: { command: "uname -a" } },
	);
	const lines = view.render(80);
	assert.ok(lines.length >= 2);
	assert.match(lines.join("\n"), /hello/);
	assert.doesNotMatch(lines.join("\n"), /expand|close/);
});
