---
name: pi-wsl
description: "WSL work from Win11 Pi: jobs, root, paths, log reads."
---

# pi-wsl

The `wsl` tool spawns `System32\wsl.exe`, so Git Bash never sees the command.
Pi's builtin `bash` is Git Bash on Windows, which rewrites Linux paths, eats
variables, and turns `\\wsl.localhost\...` into `C:\wsl.localhost\...`.

## Route the call

| The work touches | Tool |
| --- | --- |
| `C:\...`, `D:\...`, Git Bash `/c/...` | `bash` |
| `/home/...`, `/tmp/...`, `/mnt/c/...`, `\\wsl.localhost\...` | `wsl` |

Mixed work is two calls: `bash` for the Windows side, `wsl` for the Linux
side. Never hand a Linux path to `bash`.

## Run a command

1. Pass the raw command with no `wsl -d` or `bash -lc` wrapper. **Complete
   when:** the command string starts with the program you want to run.
2. Set `cwd` to a Windows or a Linux path. **Complete when:** the result header
   shows the `cwd` you expected.
3. Put long JS, nested quotes, or multi-line text in `script` with `args`, or
   in `input` beside a short command. **Complete when:** no shell quoting
   survives into the argument.
4. Give a slow launch a `timeout` between 1 and 3600 seconds. **Complete when:**
   the command finishes inside its budget.

## Long jobs

1. Start with `background: true`, plus `log: /tmp/name.log` when you want a
   stable path. **Complete when:** the result prints `PID=`, `LOG=`, and `RC=`.
2. Poll with `/wsl job <pid> <log>`, or through the `wsl` tool with
   `tail -n 40 <log>` and `ps -p <pid> -o pid,etime,cmd`. **Complete when:** you
   know whether the job runs, what its last output was, and its `Exit:` line
   once it stops.
3. Stop it with `/wsl job stop <pid>`, which ends the body and its children
   together. `kill <pid>` alone leaves the children running, and
   `pkill -f <pattern>` is the fallback when you have no pid.
   **Complete when:** `/wsl job <pid> <log>` reports the process stopped.
4. Remove the log and its `.rc` sidecar when the job finishes. **Complete
   when:** no logs from your own runs are left in `/tmp`.

A job that exits immediately returns its own output and exit code instead of a
handle, so read the result before assuming it detached. A job you stopped has
no exit status, so its `Exit:` line stays unknown.

## Root work

`sudo` has no terminal here and always stops on a password. Pass `user: root`
for package installs, system units, and files under `/etc`. The field needs
Windows-hosted Pi and is rejected inside WSL. **Complete when:** a privileged
command succeeded with no password prompt.

## Paths

- Windows to Linux: the tool maps drive letters through the distro's automount
  root, so `cwd: C:/src/mod` and `/wsl path C:\src\mod` agree.
- Linux to Windows: `/wsl path /home/dev/x` prints
  `//wsl.localhost/<distro>/home/dev/x`, which `read`, `write`, and `edit`
  accept. The reverse mapping uses the Windows default distro unless
  `WSL_DISTRO` is set.
- A UNC `cwd` or `script` also selects the distro.

**Complete when:** the path handed to the next tool exists on the host that
runs it.

## When a call is blocked

On Windows the extension blocks `bash` calls Git Bash would rewrite, and blocks
`read` / `write` / `edit` on WSL UNC and `/mnt/<drive>` paths. Take the reason,
call `wsl` with the raw command, and carry on. `PI_WSL_NO_INTERCEPT=true` turns
the hook off. A block is a routing hint, not a failure to debug.

## Read the result

The header names the outcome: `exit N`, `aborted`, or `timed out after Nms`,
followed by `cwd` and `distro` when they apply. `aborted` means the session
stopped the call and `timed out` means the budget ran out; neither is a command
failure. An unknown distro lists the installed names.

## Pitfalls

- A `wsl -d Ubuntu -- bash -lc '...'` wrapper sends the text back through Git
  Bash, which is the original problem. The common wrapper forms are stripped,
  so pass the inner command directly.
- `background` and `input` cannot combine. A detached job has no stdin, so a
  program that prompts will hang.
- A CRLF shell script runs from a temporary copy beside the source and is
  trashed on exit, which needs `gio`. A read-only source directory moves that
  copy to `/tmp` and warns that script-relative paths may fail.
- `script` picks its runner by extension: `.py` is `python3`, `.mjs`, `.cjs`,
  and `.js` are `node`, and everything else is `bash`.
- `systemctl --user` needs the default user-bus exports or `login: true`. A
  plain non-login bash has no user D-Bus.
- The first call into a distro pays its boot. Repeat the call on the same
  distro before blaming the tool for a slow start.
- `/wsl status` reports distro, user, systemd, automount root, IP, and WSL
  version in one round trip. Reach for it before diagnosing environment
  questions by hand.
