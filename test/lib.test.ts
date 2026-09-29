import assert from "node:assert/strict";
import { test } from "node:test";
import {
	backgroundCommand,
	buildCommand,
	convertArg,
	formatArgs,
	formatDistrosList,
	formatStreams,
	isDistrosAlias,
	jobStatusCommand,
	jobStopCommand,
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
	formatDuration,
	isStalled,
	nextStreamMode,
	lastNonEmptyLines,
	brandLabel,
	brandTone,
	padRow,
	visibleLen,
	prefixOutputLines,
	spinnerFrame,
	SPINNER_FRAMES,
	displayCommand,
	ellipsize,
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

test("buildCommand preserves LF script paths and cleans CRLF copies even on failure", () => {
	const out = buildCommand({
		script: "C:\\git-public\\mod\\dev\\probe.sh",
		args: ["--world", "demo"],
		userBus: false,
	});
	assert.match(out, /grep -q/);
	assert.match(out, /mktemp "\$_pi_wsl_dir\/\.pi-wsl/);
	assert.match(out, /trap 'if command -v gio/);
	assert.match(out, /sed -i 's\/\\r\$\/\/'/);
	assert.match(out, /else bash '\/mnt\/c\/git-public\/mod\/dev\/probe.sh' '--world' 'demo'/);
	assert.equal(buildCommand({ script: "/tmp/x.js", userBus: false }), "node '/tmp/x.js'");
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

test("background command returns a handle and does not leak shell quoting", () => {
	const body = backgroundCommand("printf '%s' 'hello'", "/tmp/my job.log");
	assert.match(body, /nohup env _pi_wsl_log="\$\_pi_wsl_log" setsid bash -c /);
	assert.match(body, /_pi_wsl_log='\/tmp\/my job.log'/);
	assert.match(body, /PID=%s LOG=%s RC=%s/);
	assert.throws(() => backgroundCommand("true", "relative.log"), /absolute Linux path/);
	assert.match(buildCommand({ command: "sleep 10", background: true, userBus: false }), /nohup env _pi_wsl_log=/);
});

test("background command records the exit code beside the log", () => {
	const body = backgroundCommand("exit 3", "/tmp/my job.log");
	// The body runs in a subshell so its own `exit` cannot skip the sidecar
	// write, and the printf survives shellQuote.
	assert.match(body, /\n\); _pi_wsl_code=\$\?; printf '\\''%s\\n'\\'' "\$_pi_wsl_code" > "\$_pi_wsl_log\.rc"; exit "\$_pi_wsl_code"/);
	assert.match(body, /printf 'PID=%s LOG=%s RC=%s\\n' "\$_pi_wsl_pid" "\$_pi_wsl_log" "\$_pi_wsl_log\.rc"/);
	assert.match(buildCommand({ command: "exit 3", background: true, userBus: false }), /exit "\$_pi_wsl_code"'/);
	// A brace group would let `exit` terminate the wrapper before the write.
	assert.equal(/bash -c '\{/.test(body), false);
	// A finished job leaves a zombie that kill -0 accepts, so the rc file decides
	// between a handle and inline output, and a stale rc must not pass for a run.
	assert.match(body, /rm -f -- "\$_pi_wsl_log\.rc"/);
	assert.match(body, /kill -0 "\$_pi_wsl_pid" 2>\/dev\/null && \[ ! -f "\$_pi_wsl_log\.rc" \]/);
});

test("jobStatusCommand reports the exit code only once the job has stopped", () => {
	const cmd = jobStatusCommand("1234", "/tmp/my job.log");
	assert.match(cmd, /kill -0 1234/);
	assert.match(cmd, /printf 'Process: running\\n'/);
	// The rc file is only written when the body ends, so the read has to sit in
	// the stopped branch or a live job would be reported as having no code.
	assert.ok(cmd.indexOf("[ -f") > cmd.indexOf("Process: stopped"));
	assert.ok(cmd.indexOf("Process: stopped") < cmd.indexOf("Process: running") + cmd.length);
	assert.match(cmd, /printf 'Exit: %s\\n' "\$\(cat -- '\/tmp\/my job\.log\.rc'\)"/);
	assert.match(cmd, /printf 'Exit: unknown, no rc file at %s\\n'/);
	assert.match(cmd, /tail -n 20 -- '\/tmp\/my job\.log'/);
	assert.throws(() => jobStatusCommand("12a", "/tmp/a.log"), /pid must be digits/);
	assert.throws(() => jobStatusCommand("1", "a.log"), /log must be an absolute Linux path/);
});

test("background command starts the job in its own process group", () => {
	// Without setsid the job shares the tool's own group, so a group signal from
	// /wsl job stop would hit the tool's shell and a single-pid kill would orphan
	// the body's children.
	const body = backgroundCommand("sleep 300", "/tmp/job.log");
	assert.match(body, /nohup env _pi_wsl_log="\$\_pi_wsl_log" setsid bash -c /);
	assert.match(buildCommand({ command: "sleep 300", background: true, userBus: false }), /setsid bash -c /);
});

test("jobStopCommand signals the whole group and escalates to KILL", () => {
	const cmd = jobStopCommand("4321");
	// Liveness is the group, not the leader: a group outlives its leader, so a
	// leader-only check would call a job gone while a TERM-ignoring child runs on.
	assert.equal(/kill -0 4321 /.test(cmd), false);
	assert.equal((cmd.match(/kill -0 -4321/g) ?? []).length, 3);
	assert.match(cmd, /^if kill -0 -4321 2>\/dev\/null; then kill -TERM -4321/);
	assert.match(cmd, /"\$_pi_wsl_n" -lt 25/);
	assert.match(cmd, /kill -KILL -4321/);
	assert.match(cmd, /'Stopped: KILL sent to process group %s\\n' 4321/);
	assert.match(cmd, /'Stopped: process group %s exited after TERM\\n' 4321/);
	assert.match(cmd, /'Not running: no process group %s\\n' 4321/);
	// Nothing signals the group when the job is already gone.
	assert.ok(cmd.indexOf("kill -TERM -4321") < cmd.indexOf("Not running"));
	assert.throws(() => jobStopCommand("43 21"), /pid must be digits/);
	assert.throws(() => jobStopCommand(""), /pid must be digits/);
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
	assert.deepEqual(parseWslList("* Ubuntu\nDebian\n"), ["Ubuntu", "Debian"]);
	assert.deepEqual(parseWslList("*\u0000 \u0000U\u0000b\u0000u\u0000n\u0000t\u0000u\u0000\r\u0000\n\u0000"), ["Ubuntu"]);
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

test("visible width and truncation handle wide Unicode and ANSI text", () => {
	assert.equal(visibleLen("第1次"), 5);
	assert.equal(visibleLen("😀"), 2);
	assert.equal(visibleLen("\x1b[31m第1次\x1b[0m"), 5);
	assert.equal(ellipsize("命令中文", 5), "命令…");
	assert.equal(visibleLen(ellipsize("😀😀😀", 5)), 5);
	assert.equal(ellipsize("👨‍👩‍👧‍👦", 2), "👨‍👩‍👧‍👦");
	assert.equal(visibleLen(ellipsize("\x1b[31mabcdef\x1b[0m", 4)), 4);
	const row = padRow("\x1b[31m命令😀\x1b[0m", "\x1b[32mexit 0\x1b[0m", 12);
	assert.ok(visibleLen(row) <= 12, `${visibleLen(row)} > 12: ${row}`);
});

test("elapsed and stall helpers", () => {
	assert.equal(formatDuration(1200), "1.2s");
	assert.equal(isStalled(0, 14_999, 15_000), false);
	assert.equal(isStalled(0, 15_000, 15_000), true);
	assert.equal(nextStreamMode("both"), "stdout");
	assert.equal(nextStreamMode("stdout"), "stderr");
	assert.equal(nextStreamMode("stderr"), "both");
	assert.equal(lastNonEmptyLines("a\n\nb\nc\n", 2), "b\nc");
	assert.equal(brandLabel(undefined), "WSL");
	assert.equal(brandLabel(null), "WSL");
	assert.equal(brandLabel("default"), "WSL");
	assert.equal(brandLabel("Debian"), "Debian");
	assert.equal(brandTone({}), "toolTitle");
	assert.equal(brandTone({ stalled: true }), "warning");
	assert.equal(brandTone({ killed: true }), "error");
	assert.equal(brandTone({ stalled: true, killed: true }), "error");
	const row = padRow("left", "exit 0  1.2s", 24);
	assert.equal(visibleLen(row), 24);
	assert.match(row, /left/);
	assert.match(row, /exit 0/);
	assert.deepEqual(prefixOutputLines("a\nb", ">"), ["> a", "> b"]);
	assert.ok(SPINNER_FRAMES.includes(spinnerFrame(0) as (typeof SPINNER_FRAMES)[number]));
	assert.notEqual(spinnerFrame(0), spinnerFrame(120));
	assert.equal(ellipsize("abcdef", 4), "abc…");
	assert.equal(
		displayCommand({ command: "sleep 10" }, "export XDG_RUNTIME_DIR='x'; export DBUS_SESSION_BUS_ADDRESS='y'; sleep 10"),
		"sleep 10",
	);
	assert.equal(
		displayCommand(undefined, "export XDG_RUNTIME_DIR='x'; export FOO='1'; sleep 10"),
		"sleep 10",
	);
});

test("pathInterceptReason only flags UNC and /mnt", () => {
	assert.match(pathInterceptReason("\\\\wsl.localhost\\Ubuntu\\home\\dev\\a.ts") ?? "", /WSL UNC/);
	assert.match(pathInterceptReason("/mnt/c/proj/a.ts") ?? "", /\/mnt\//);
	assert.equal(pathInterceptReason("C:\\src\\a.ts"), null);
	assert.equal(pathInterceptReason("/home/dev/a.ts"), null);
});
