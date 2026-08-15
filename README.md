# pi-wsl

Pi on Windows runs its `bash` tool through Git Bash. Git Bash rewrites Linux paths and quote layers before WSL sees them. This extension spawn()s `wsl.exe` instead, so the command arrives intact.

0.2.0. Still a small tool. The surface can still move.

## Install

Needs [Pi](https://github.com/earendil-works/pi) on Windows with WSL installed.

```bash
pi install git:github.com/apoapostolov/pi-wsl@v0.2.0
```

Start a new Pi process after install. `/reload` picks up the code; a pin change needs a restart.

## Why this exists

These fail when Pi's `bash` tool goes through Git Bash:

| What you typed | What actually ran |
| --- | --- |
| `python3 /mnt/c/proj/sync.py` | `python3 /mnt/c/Users/.../C:/Program Files/Git/mnt/c/proj/sync.py` |
| `wsl -- bash -lc 'DEST=/tmp/x; mkdir -p $DEST'` | `DEST` empty, `mkdir: missing operand` |
| `node "\\wsl.localhost\Ubuntu\home\dev\run.mjs"` | `Cannot find module 'C:\wsl.localhost\Ubuntu\home\dev\run.mjs'` |

`MSYS_NO_PATHCONV=1` only helps some of those. Nested quotes and `$VARS` still die. This tool never goes through Git Bash, so none of those rewrites happen.

## Use it

Ask Pi to run the work in WSL, or call the tool:

```text
command: node --check scripts/module.mjs
cwd: C:\git-public\my-module
```

```text
script: //wsl.localhost/Ubuntu/home/dev/bin/qa.mjs
args: ["--world", "demo", "status"]
timeout: 180
```

Human shortcut:

```text
/wsl uname -a
```

Prefer this tool over `bash` when the path is Linux, `/mnt/c`, or `\\wsl.localhost`. Pass the raw command. Do not wrap it in `wsl -d` or `bash -lc`.

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

These showed up while building Foundry modules on Win11 + WSL. They are real, and they stay out of this tool on purpose.

- File watchers on `/mnt/c` (9p misses events). Copy onto the Linux disk and reload there.
- Creating a Linux venv with Win32 Python. Create it in WSL.
- Mixing a WSL `/tmp` zip with Windows `gh`. Keep the git/gh chain in one WSL command.
- Pi `read` on `\\wsl.localhost\...` returning `EPERM`. Use `wsl` `cat`, or a `C:\` path.

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
