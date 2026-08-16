import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildCommand,
	convertArg,
	formatArgs,
	formatDistrosList,
	formatStreams,
	isDistrosAlias,
	looksLikeConvertiblePath,
	looksLikeMissingDistro,
	parseWslList,
	parseWslUnc,
	resolveDistro,
	runnerFor,
	shellQuote,
	stripLongPathPrefix,
	toForwardUnc,
	toWslPath,
	unwrapWslWrapper,
	bashInterceptReason,
	findRewriteRisk,
	pathInterceptReason,
	parsePathQuery,
	toWindowsPathForWslpath,
	withCdPrefix,
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

test("toWslPath maps Git Bash /c/foo and strips \\\\?\\", () => {
	assert.equal(toWslPath("/c/foo"), "/mnt/c/foo");
	assert.equal(toWslPath("/c"), "/mnt/c");
	assert.equal(toWslPath("\\\\?\\C:\\foo\\bar"), "/mnt/c/foo/bar");
	assert.equal(toWslPath("/dev/foo"), "/dev/foo");
	assert.equal(toWslPath("/home/dev/x"), "/home/dev/x");
	assert.equal(toWslPath("/mnt/c/git-public/Foo"), "/mnt/c/git-public/Foo");
});

test("parseWslUnc keeps the distro name", () => {
	assert.deepEqual(parseWslUnc("\\\\wsl.localhost\\Debian\\home\\dev"), {
		distro: "Debian",
		posixPath: "/home/dev",
	});
	assert.deepEqual(parseWslUnc("C:\\wsl.localhost\\Ubuntu-24.04\\tmp\\x"), {
		distro: "Ubuntu-24.04",
		posixPath: "/tmp/x",
	});
	assert.deepEqual(parseWslUnc("\\\\wsl.localhost\\Ubuntu"), {
		distro: "Ubuntu",
		posixPath: "/",
	});
	assert.equal(parseWslUnc("C:\\foo\\bar"), null);
});

test("resolveDistro prefers explicit, then UNC, then env", () => {
	const prev = process.env.WSL_DISTRO;
	process.env.WSL_DISTRO = "FedoraLinux-42";
	assert.equal(resolveDistro("Debian"), "Debian");
	assert.equal(
		resolveDistro(undefined, { cwd: "\\\\wsl.localhost\\Ubuntu\\home\\dev" }),
		"Ubuntu",
	);
	assert.equal(resolveDistro(undefined, { cwd: "C:\\git-public\\x" }), "FedoraLinux-42");
	delete process.env.WSL_DISTRO;
	assert.equal(resolveDistro(undefined, { cwd: "C:\\git-public\\x" }), undefined);
	if (prev === undefined) delete process.env.WSL_DISTRO;
	else process.env.WSL_DISTRO = prev;
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

test("formatArgs quotes array items and converts Windows and Git Bash paths", () => {
	assert.equal(formatArgs(["--world", "demo"]), " '--world' 'demo'");
	assert.equal(
		formatArgs(["C:\\git-public\\mod\\dev\\probe.js"]),
		" '/mnt/c/git-public/mod/dev/probe.js'",
	);
	assert.equal(formatArgs(["/c/git-public/mod/dev/probe.js"]), " '/mnt/c/git-public/mod/dev/probe.js'");
	assert.equal(formatArgs(" --raw still-raw"), " --raw still-raw");
});

test("looksLikeConvertiblePath is conservative", () => {
	assert.equal(looksLikeConvertiblePath("C:\\git\\x"), true);
	assert.equal(looksLikeConvertiblePath("/c/foo"), true);
	assert.equal(looksLikeConvertiblePath("JSON.stringify({has:1})"), false);
	assert.equal(looksLikeConvertiblePath("1+1"), false);
	assert.equal(looksLikeConvertiblePath("/home/dev"), false);
	assert.equal(convertArg("C:/tmp/a.js"), "/mnt/c/tmp/a.js");
	assert.equal(convertArg("--eval-file"), "--eval-file");
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

test("formatStreams splits stdout and stderr", () => {
	const both = formatStreams("hello\n", "warn\n");
	assert.equal(both.text, "--- stdout ---\nhello\n\n--- stderr ---\nwarn\n");
	assert.equal(formatStreams("only out", "").text, "--- stdout ---\nonly out");
	assert.equal(formatStreams("", "").text, "(no output)");
});

test("parseWslList decodes UTF-16LE wsl -l output", () => {
	const names = "Ubuntu-24.04\r\nDebian\r\n";
	const utf16 = Buffer.from(`\ufeff${names}`, "utf16le");
	assert.deepEqual(parseWslList(utf16), ["Ubuntu-24.04", "Debian"]);
	assert.deepEqual(parseWslList("Ubuntu\nDebian\n"), ["Ubuntu", "Debian"]);
});

test("isDistrosAlias matches the slash-command words", () => {
	assert.equal(isDistrosAlias("distros"), true);
	assert.equal(isDistrosAlias("distro"), true);
	assert.equal(isDistrosAlias("list"), true);
	assert.equal(isDistrosAlias("-l"), true);
	assert.equal(isDistrosAlias("uname -a"), false);
	assert.equal(formatDistrosList(["Ubuntu-24.04", "Debian"]), "Ubuntu-24.04\nDebian");
	assert.equal(formatDistrosList([]), "No WSL distros found.");
});

test("looksLikeMissingDistro matches wsl.exe wording", () => {
	assert.equal(
		looksLikeMissingDistro("There is no distribution with the supplied name."),
		true,
	);
	assert.equal(looksLikeMissingDistro("exit 1: not found"), false);
});

test("stripLongPathPrefix", () => {
	assert.equal(stripLongPathPrefix("//?/C:/foo"), "C:/foo");
	assert.equal(stripLongPathPrefix("C:/foo"), "C:/foo");
});

test("findRewriteRisk catches Git Bash rewrite bait and ignores ordinary Windows bash", () => {
	assert.equal(findRewriteRisk("python3 /mnt/c/proj/sync.py"), "/mnt/<drive>");
	assert.equal(findRewriteRisk('node "\\\\wsl.localhost\\Ubuntu\\home\\dev\\run.mjs"'), "\\\\wsl.localhost");
	assert.equal(findRewriteRisk("wsl -d Ubuntu-24.04 -- bash -lc 'true'"), "wsl.exe");
	assert.equal(findRewriteRisk("MSYS_NO_PATHCONV=1 wsl -- true"), "MSYS_NO_PATHCONV");
	assert.equal(findRewriteRisk("cat /home/dev/x"), "/home/");
	assert.equal(findRewriteRisk("git status"), null);
	assert.equal(findRewriteRisk("ls /c/Users/theap"), null);
	assert.equal(findRewriteRisk("npm test"), null);
});

test("bashInterceptReason names the wsl tool", () => {
	const reason = bashInterceptReason("python3 /mnt/c/proj/sync.py");
	assert.match(reason ?? "", /wsl tool/);
	assert.equal(bashInterceptReason("git status"), null);
});

test("toWindowsPathForWslpath only converts drive and Git Bash /c", () => {
	assert.equal(toWindowsPathForWslpath("C:\\Users\\me"), "C:\\Users\\me");
	assert.equal(toWindowsPathForWslpath("/c/Users/me"), "C:\\Users\\me");
	assert.equal(toWindowsPathForWslpath("/home/dev"), undefined);
	assert.equal(toWindowsPathForWslpath("\\\\wsl.localhost\\Ubuntu\\home"), undefined);
});

test("withCdPrefix wraps the body", () => {
	assert.equal(withCdPrefix("true", undefined), "true");
	assert.match(withCdPrefix("uname -a", "/mnt/c/src"), /cd -- '\/mnt\/c\/src' &&/);
});

test("parsePathQuery handles /wsl path", () => {
	assert.deepEqual(parsePathQuery("path C:\\foo"), { kind: "path", input: "C:\\foo" });
	assert.deepEqual(parsePathQuery("path"), { kind: "path-usage" });
	assert.equal(parsePathQuery("uname -a"), null);
	assert.equal(parsePathQuery("pathfind"), null);
});

test("pathInterceptReason only flags UNC and /mnt", () => {
	assert.match(pathInterceptReason("\\\\wsl.localhost\\Ubuntu\\home\\dev\\a.ts") ?? "", /WSL UNC/);
	assert.match(pathInterceptReason("/mnt/c/proj/a.ts") ?? "", /\/mnt\//);
	assert.equal(pathInterceptReason("C:\\src\\a.ts"), null);
	assert.equal(pathInterceptReason("/home/dev/a.ts"), null);
});
