<!-- markdownlint-disable MD033 -->

<div align="center">

  <h1>pi-wsl</h1>

  <p>Run Pi commands in WSL with the paths and quotes you actually typed.</p>

  <p>
    <a href="#readme"><img src="https://img.shields.io/badge/Type-Pi%20extension-555" alt="Type: Pi extension"></a>
    <a href="./package.json"><img src="https://img.shields.io/badge/Language-TypeScript-555" alt="Language: TypeScript"></a>
    <a href="https://www.npmjs.com/package/@apoapostolov/pi-wsl/v/0.3.9"><img src="https://img.shields.io/badge/Version-0.3.9-blue" alt="Version: 0.3.9"></a>
    <a href="https://www.npmjs.com/package/@apoapostolov/pi-wsl/v/0.3.9"><img src="https://img.shields.io/badge/Last%20release-2026--09--29-blue" alt="Last release: 2026-09-29"></a>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-green" alt="License: MIT"></a>
  </p>

</div>

This
extension calls `wsl.exe` directly, so Git Bash cannot rewrite `/mnt/c` paths,
UNC files, variables, or nested shell commands on the way to Linux.

## Why this exists

On Windows, Pi's builtin `bash` tool is Git Bash (MSYS). MSYS rewrites Unix paths and strips quote layers before anything reaches WSL, so a Linux path, a `/mnt/c` script, or a `\\wsl.localhost\...` file does not arrive as typed.

Wrapping the call in `wsl -d ... -- bash -lc '...'` does not fix it, because that string still goes through Git Bash. `MSYS_NO_PATHCONV=1` only blocks some path rewrites, while `$VARS` vanish and nested quotes collapse. `\\wsl.localhost\Distro\home\dev\run.mjs` becomes `C:\wsl.localhost\Distro\home\dev\run.mjs`, and Node dies `MODULE_NOT_FOUND`.

| What you typed | What Git Bash actually ran |
| --- | --- |
| `python3 /mnt/c/proj/sync.py` | `python3 /mnt/c/Users/.../C:/Program Files/Git/mnt/c/proj/sync.py` |
| `wsl -- bash -lc 'DEST=/tmp/x; mkdir -p $DEST'` | `DEST` empty, `mkdir: missing operand` |
| `node "\\wsl.localhost\Ubuntu\home\dev\run.mjs"` | `Cannot find module 'C:\wsl.localhost\Ubuntu\home\dev\run.mjs'` |

## Install

Needs [Pi](https://github.com/earendil-works/pi) on Windows with WSL installed. Detached jobs also need `setsid` from util-linux, which every mainstream distro carries. Without it a background job exits `127` instead of starting.

```bash
pi install npm:@apoapostolov/pi-wsl
```

Git install still works: `pi install git:github.com/apoapostolov/pi-wsl`.

Start a new Pi process after install. `/reload` picks up the code; a pin change needs a restart.

The package ships a `pi-wsl` skill with the routing rules, job workflow, and known traps. It loads next to the tool.

## Use it

Ask Pi to run the work in WSL, or call the tool:

```text
command: node --check scripts/module.mjs
cwd: C:\src\my-module
```

```text
script: //wsl.localhost/Ubuntu/home/dev/bin/qa.mjs
args: ["--world", "demo", "status"]
timeout: 180
```

Prefer this tool over `bash` when the path is Linux, `/mnt/c`, or `\\wsl.localhost`. Pass the raw command, and do not wrap it in `wsl -d` or `bash -lc`.

On Win11, if the model still calls builtin `bash` with those paths, pi-wsl blocks the call and tells it to use this tool. It does not re-run the command through Git Bash. The same hook blocks `read` / `write` / `edit` on `\\wsl.localhost` and `/mnt/<drive>`. Set `PI_WSL_NO_INTERCEPT=true` to disable it.

### Long-running jobs

A dev server or a long build outlives a tool call. Start it detached instead of holding the call open:

```text
command: npm run dev
cwd: C:\src\my-module
background: true
log: /tmp/my-module-dev.log
```

The result prints a handle: `PID=1121025 LOG=/tmp/my-module-dev.log RC=/tmp/my-module-dev.log.rc`. Poll it with `/wsl job <pid> <log>`, or with ordinary `wsl` calls such as `tail -n 40 /tmp/my-module-dev.log` and `ps -p 1121025 -o pid,etime,cmd`. Omit `log` to get a generated path under `/tmp`.

The body writes its exit status to the `RC` path as its last act, so a job that ends after the handoff can still be judged. A job that exits during the handoff returns its own output and exit code instead of a handle, so read the result before assuming it detached. Detached commands have no stdin, so they cannot read `input`.

`PID=` is also the job's process group, so `/wsl job stop <pid>` ends the whole tree, children included. It sends TERM, waits five seconds, then sends KILL to anything still standing, and says which happened. Prefer it to a bare `kill <pid>`, which ends the wrapper and leaves the body's children running as orphans. A job that is stopped has no exit status, so its `RC` file stays absent and `/wsl job` reports the exit as unknown.

`/wsl job <pid> <log>` and `/wsl job stop <pid>` reason about different things, on purpose. Status watches the group leader, because the leader is the wrapper that waits on the body, and the `RC` file appearing is the positive sign the body ended. Stop watches the whole process group, because a group outlives its leader and a child that ignored TERM would otherwise be reported as gone while still running.

### Root work

`sudo` needs a terminal and a password, so it always fails here. Pass `user: root` for package installs, system units, and files under `/etc`:

```text
command: apt-get install -y ripgrep
user: root
```

### Paths in both directions

Drive-letter `cwd` and `script` paths resolve through the distro's automount root, which is cached after the first lookup, so a custom `automount.root` still works. The first call into a distro wakes it. If the WSL build has no `--cd`, the command is prefixed with `cd -- <dir>`.

`/wsl path` maps either way:

```text
/wsl path C:\src\my-module      ->  /mnt/c/src/my-module
/wsl path /home/dev/bin/qa.mjs  ->  //wsl.localhost/Ubuntu/home/dev/bin/qa.mjs
```

The reverse form is what you hand to `read`, `write`, and `edit`. It uses the Windows default distro unless `WSL_DISTRO` is set. A UNC `cwd` or `script` also selects the distro.

### Slash commands

| Command | Result |
| --- | --- |
| `/wsl <command>` | Run the command and show its output |
| `/wsl status` | Distro, user, systemd state, automount root, IP, WSL version |
| `/wsl distros` | Installed distro names |
| `/wsl path <p>` | Map a Windows, UNC, or Linux path |
| `/wsl job <pid> <log>` | Process state, exit code once ended, plus the last 20 log lines |
| `/wsl job stop <pid>` | Stop a detached job and its children |

### TUI

The TUI row keeps the green tool box. Top line: icon and bold **WSL** (or **Debian** when that distro is set) plus the command on the left, exit and elapsed time on the right. Output uses `>` (stderr `!`) instead of a stdout banner. While it runs, a braille spinner sits on that `>` line. After 15s with no output the time and mark turn yellow (`PI_WSL_STALL_WARN`). A stopped call reads `aborted` or `timed out`, which are separate from a command that exited non-zero.

## Options

| Field | Default | Notes |
| --- | --- | --- |
| `command` | | Raw bash. Mutually exclusive with `script` in practice |
| `script` | | File to run. Windows, Git Bash `/c/...`, UNC, eaten UNC, or Linux path |
| `args` | | Array (quoted) or one string. Windows, UNC, and `/c/...` items are converted |
| `cwd` | | Converted like `script`. A UNC cwd also selects that distro |
| `timeout` | `60` | Seconds, from 1 to 3600. Abort kills the WSL process tree |
| `distro` | UNC, then `WSL_DISTRO`, then WSL default | Pass `distro` to force one |
| `user` | distro default | Run as a named WSL user, such as `root`. Windows-hosted Pi only |
| `background` | `false` | Start a detached job and return its PID, log path, and exit-code path |
| `log` | generated path | Absolute Linux output path for a background job |
| `env` | | Extra variables inside WSL |
| `input` | | Written to the command's stdin. Use for long JS. Not with `background` |
| `login` | `false` | `bash -l` |
| `userBus` | `true` | Sets `XDG_RUNTIME_DIR` and `DBUS_SESSION_BUS_ADDRESS` when unset. Needed for `systemctl --user` |
| `crlf` | `true` | For CRLF shell scripts, run a cleaned temporary copy beside the source and trash it after exit (requires `gio`). LF scripts, Python, and JavaScript run at their original paths |

The tool registers on Windows and inside WSL. It does nothing on macOS or native Linux.

## What this does not do

Pi's `read` tool can still return `EPERM` on `\\wsl.localhost\...`. Cat the file through this tool, or use a `C:\` path.

The `bash` hook can only block a call. It cannot rewrite one, so a bash command that merely mentions `/mnt/c` is still rejected rather than repaired.

For PowerShell, cmd, and a doctor, install [`@bacnh85/pi-windows-tools`](https://www.npmjs.com/package/@bacnh85/pi-windows-tools).

## Config

```bash
# optional, if you do not want the default distro
setx WSL_DISTRO Debian
```

Or pass `distro` on the tool call.

## Develop

```bash
npm test
```

Tests cover path repair, UNC distro pick, Git Bash `/c/` map, `wsl -l` decoding, quoting, env, the CRLF copy, the detached-command wrapper and its exit-code sidecar, job status, and the process-group stop. They do not need WSL.

## License

MIT
