# pi-wsl

Pi's `bash` tool is Git Bash. You need Linux, `/mnt/c`, and `\\wsl.localhost` to arrive uncorrupted.

This extension spawn()s `System32\wsl.exe` and runs the command in WSL, so Git Bash never sees the text.

## Why this exists

On Windows, Pi's builtin `bash` tool is Git Bash (MSYS). MSYS rewrites Unix paths and strips quote layers before anything reaches WSL, so a Linux path, a `/mnt/c` script, or a `\\wsl.localhost\...` file does not arrive as typed.

Wrapping the call in `wsl -d ... -- bash -lc '...'` does not fix it, because that string still goes through Git Bash. `MSYS_NO_PATHCONV=1` only blocks some path rewrites, while `$VARS` vanish and nested quotes collapse. `\\wsl.localhost\Distro\home\dev\run.mjs` becomes `C:\wsl.localhost\Distro\home\dev\run.mjs`, and Node dies `MODULE_NOT_FOUND`.

| What you typed | What Git Bash actually ran |
| --- | --- |
| `python3 /mnt/c/proj/sync.py` | `python3 /mnt/c/Users/.../C:/Program Files/Git/mnt/c/proj/sync.py` |
| `wsl -- bash -lc 'DEST=/tmp/x; mkdir -p $DEST'` | `DEST` empty, `mkdir: missing operand` |
| `node "\\wsl.localhost\Ubuntu\home\dev\run.mjs"` | `Cannot find module 'C:\wsl.localhost\Ubuntu\home\dev\run.mjs'` |

## Install

Needs [Pi](https://github.com/earendil-works/pi) on Windows with WSL installed.

```bash
pi install npm:@apoapostolov/pi-wsl
```

Git install still works: `pi install git:github.com/apoapostolov/pi-wsl@v0.3.1`.

Start a new Pi process after install. `/reload` picks up the code; a pin change needs a restart.

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

Human shortcuts:

```text
/wsl uname -a
/wsl distros
/wsl path C:\\src\\my-module
```

Prefer this tool over `bash` when the path is Linux, `/mnt/c`, or `\\wsl.localhost`. Pass the raw command, and do not wrap it in `wsl -d` or `bash -lc`.

On Win11, if the model still calls builtin `bash` with those paths, pi-wsl blocks the call and tells it to use this tool. It does not re-run the command through Git Bash. The same hook blocks `read` / `write` / `edit` on `\\wsl.localhost` and `/mnt/<drive>`. Set `PI_WSL_NO_INTERCEPT=true` to disable it.

Drive-letter cwd and script paths go through `wslpath -u` when WSL is up. A first call wakes the distro. If this WSL build has no `--cd`, the command is prefixed with `cd -- <dir>`.

## Options

| Field | Default | Notes |
| --- | --- | --- |
| `command` | | Raw bash. Mutually exclusive with `script` in practice |
| `script` | | File to run. Windows, Git Bash `/c/...`, UNC, eaten UNC, or Linux path |
| `args` | | Array (quoted) or one string. Windows, UNC, and `/c/...` items are converted |
| `cwd` | | Converted like `script`. A UNC cwd also selects that distro |
| `timeout` | `60` | Seconds. Bump it for slow launches. Abort kills the WSL process tree |
| `distro` | UNC, then `WSL_DISTRO`, then WSL default | Pass `distro` to force one |
| `env` | | Extra variables inside WSL |
| `input` | | Written to the command's stdin. Use for long JS |
| `login` | `false` | `bash -l` |
| `userBus` | `true` | Sets `XDG_RUNTIME_DIR` and `DBUS_SESSION_BUS_ADDRESS` when unset. Needed for `systemctl --user` |
| `crlf` | `true` | For `script`: copy to `/tmp`, strip CR, run the copy. Does not edit the original file |

The tool registers on Windows and inside WSL. It does nothing on macOS or native Linux.

## What this does not do

Pi's `read` tool can still return `EPERM` on `\\wsl.localhost\...`. Cat the file through this tool, or use a `C:\` path.

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

Tests cover path repair, UNC distro pick, Git Bash `/c/` map, UTF-16LE `wsl -l`, quoting, env, and the CRLF copy. They do not need WSL.

## License

MIT
