import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildCommand,
	convertArg,
	formatArgs,
	looksLikeConvertiblePath,
	resolveDistro,
	runnerFor,
	shellQuote,
	toForwardUnc,
	toWslPath,
	unwrapWslWrapper,
} from "../src/lib.ts";

test("toWslPath converts drive letters", () => {
	assert.equal(toWslPath("C:\\git-public\\Foo"), "/mnt/c/git-public/Foo");
	assert.equal(toWslPath("D:/work/x"), "/mnt/d/work/x");
});

test("toWslPath repairs eaten UNC and real UNC", () => {
	assert.equal(
		toWslPath("C:\\wsl.localhost\\Ubuntu-24.04\\home\\dev\\.config"),
		"/home/dev/.config",
	);
	assert.equal(
		toWslPath("C:/wsl.localhost/Debian/home/dev/bin/run.mjs"),
		"/home/dev/bin/run.mjs",
	);
	assert.equal(
		toWslPath("//wsl.localhost/Ubuntu-24.04/home/dev/.config"),
		"/home/dev/.config",
	);
	assert.equal(
		toWslPath("\\\\wsl$\\Ubuntu-24.04\\tmp\\probe.js"),
		"/tmp/probe.js",
	);
});

test("toWslPath leaves Linux paths alone", () => {
	assert.equal(toWslPath("/home/dev/x"), "/home/dev/x");
	assert.equal(toWslPath("/mnt/c/git-public/Foo"), "/mnt/c/git-public/Foo");
});

test("toForwardUnc requires an explicit distro", () => {
	assert.equal(toForwardUnc("/home/dev/x", "Debian"), "//wsl.localhost/Debian/home/dev/x");
});

test("runnerFor picks by extension", () => {
	assert.equal(runnerFor("/home/a/qa.mjs"), "node");
	assert.equal(runnerFor("/tmp/sync.py"), "python3");
	assert.equal(runnerFor("/tmp/run.sh"), "bash");
});

test("unwrapWslWrapper strips Git Bash wrappers", () => {
	assert.equal(
		unwrapWslWrapper("MSYS_NO_PATHCONV=1 wsl -d Ubuntu-24.04 -- bash -lc 'echo hi'"),
		"echo hi",
	);
	assert.equal(unwrapWslWrapper("wsl -- echo hi"), "echo hi");
	assert.equal(unwrapWslWrapper("echo hi"), "echo hi");
});

test("formatArgs quotes array items and converts Windows paths", () => {
	assert.equal(formatArgs(["--world", "demo"]), " '--world' 'demo'");
	assert.equal(
		formatArgs(["C:\\git-public\\mod\\dev\\probe.js"]),
		" '/mnt/c/git-public/mod/dev/probe.js'",
	);
	assert.equal(formatArgs(" --raw still-raw"), " --raw still-raw");
});

test("looksLikeConvertiblePath is conservative", () => {
	assert.equal(looksLikeConvertiblePath("C:\\git\\x"), true);
	assert.equal(looksLikeConvertiblePath("JSON.stringify({has:1})"), false);
	assert.equal(looksLikeConvertiblePath("1+1"), false);
	assert.equal(convertArg("C:/tmp/a.js"), "/mnt/c/tmp/a.js");
	assert.equal(convertArg("--eval-file"), "--eval-file");
});

test("resolveDistro omits -d unless named", () => {
	const prev = process.env.WSL_DISTRO;
	delete process.env.WSL_DISTRO;
	assert.equal(resolveDistro(undefined), undefined);
	assert.equal(resolveDistro("Debian"), "Debian");
	process.env.WSL_DISTRO = "FedoraLinux-42";
	assert.equal(resolveDistro(undefined), "FedoraLinux-42");
	if (prev === undefined) delete process.env.WSL_DISTRO;
	else process.env.WSL_DISTRO = prev;
});

test("buildCommand copies script to /tmp and strips CR by default", () => {
	const out = buildCommand({
		script: "C:\\git-public\\mod\\dev\\probe.js",
		args: ["--world", "demo"],
		userBus: false,
	});
	assert.match(out, /mktemp \/tmp\/pi-wsl/);
	assert.match(out, /sed -i 's\/\\r\$\/\/'/);
	assert.match(out, /node "\$_pi_wsl" '--world' 'demo'/);
	assert.doesNotMatch(out, /XDG_RUNTIME_DIR/);
});

test("buildCommand can skip crlf copy", () => {
	const out = buildCommand({
		script: "/home/dev/run.py",
		crlf: false,
		userBus: false,
	});
	assert.equal(out, "python3 '/home/dev/run.py'");
});

test("buildCommand exports env and the user bus by default", () => {
	const out = buildCommand({
		command: "systemctl --user status foo",
		env: { FVTT_WORLD: "test-world" },
	});
	assert.match(out, /XDG_RUNTIME_DIR/);
	assert.match(out, /DBUS_SESSION_BUS_ADDRESS/);
	assert.match(out, /export FVTT_WORLD='test-world'/);
	assert.match(out, /systemctl --user status foo/);
});

test("buildCommand rejects bad env names", () => {
	assert.throws(
		() => buildCommand({ command: "true", env: { "FOO BAR": "1" }, userBus: false }),
		/invalid env name/,
	);
});

test("shellQuote handles embedded quotes", () => {
	assert.equal(shellQuote("it's"), `'it'\\''s'`);
});
