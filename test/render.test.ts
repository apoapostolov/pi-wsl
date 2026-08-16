import assert from "node:assert/strict";
import { test } from "node:test";
import { expandButton, renderWslResult, type WslRenderState } from "../src/render.ts";

const VALID_BG = new Set([
	"selectedBg",
	"scrollbarThumb",
	"searchMatchBg",
	"userMessageBg",
	"customMessageBg",
	"toolPendingBg",
	"toolSuccessBg",
	"toolErrorBg",
]);

function themeLike() {
	const bgNames: string[] = [];
	return {
		bgNames,
		theme: {
			fg: (_name: string, text: string) => text,
			bold: (text: string) => text,
			bg: (name: string, text: string) => {
				bgNames.push(name);
				if (!VALID_BG.has(name)) {
					throw new Error(`Unknown theme background color: ${name}`);
				}
				return text;
			},
		},
	};
}

test("expandButton uses selectedBg, never accent", () => {
	const { theme, bgNames } = themeLike();
	assert.doesNotThrow(() => expandButton(theme, false));
	assert.doesNotThrow(() => expandButton(theme, true));
	assert.deepEqual(bgNames, ["selectedBg", "selectedBg"]);
	assert.match(expandButton(theme, false), /expand/);
	assert.match(expandButton(theme, true), /close/);
});

test("expandButton falls back when bg throws or is missing", () => {
	const throwing = {
		fg: (_name: string, text: string) => text,
		bold: (text: string) => text,
		bg: () => {
			throw new Error("Unknown theme background color: accent");
		},
	};
	assert.equal(expandButton(throwing, false), "[expand]");
	assert.equal(expandButton({ fg: (_n, t) => t, bold: (t) => t }, true), "[close]");
});

test("renderWslResult does not throw the Win11 Pi accent crash", () => {
	const { theme, bgNames } = themeLike();
	const state: WslRenderState = {};
	const view = renderWslResult(
		{ details: { stdout: "hello\nworld\n", code: 0, startedAt: 1, endedAt: 2 } },
		{ expanded: false, isPartial: false },
		theme,
		{ state, invalidate() {}, executionStarted: true, args: { command: "uname -a" } },
	);
	let lines: string[] = [];
	assert.doesNotThrow(() => {
		lines = view.render(80);
	});
	assert.ok(lines.length >= 2);
	assert.match(lines.join("\n"), /expand/);
	assert.ok(bgNames.every((name) => name === "selectedBg"));
	assert.ok(!bgNames.includes("accent"));
});
