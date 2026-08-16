import assert from "node:assert/strict";
import { test } from "node:test";
import { renderWslResult, type WslRenderState } from "../src/render.ts";

function themeLike() {
	return {
		fg: (_name: string, text: string) => text,
		bold: (text: string) => text,
		bg: (name: string, text: string) => {
			throw new Error(`Unknown theme background color: ${name}`);
		},
	};
}

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
