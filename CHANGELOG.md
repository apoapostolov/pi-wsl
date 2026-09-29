# Changelog

## 0.3.9 - 2026-09-29

A detached job can be stopped from Pi.

### Added

- `/wsl job stop <pid>` terminates a detached job. The handle's `PID=` is the
  job's process group, so the stop reaches the body's children as well as the
  wrapper, which a single-pid `kill` left running as orphans. TERM first, then
  KILL for anything still standing after a five second grace, and the result
  says which happened. A group that is already gone is reported, not signalled.
- Detached jobs need `setsid` from util-linux. Without it the job exits `127`
  instead of starting.

### Changed

- A background job is launched with `setsid`, so it gets its own session and
  process group. Previously it shared the tool's own process group, which made a
  group signal unsafe: `kill -TERM -<pid>` against a handle from the old
  launcher would have signalled the tool's own shell. Only handles from 0.3.9
  onward carry a usable process group.

### Known limitations

- Right after a stop, a not-yet-reaped process can leave the group briefly
  visible, so a stop that only needed TERM may occasionally be worded as
  `KILL sent`. It is cosmetic and does not leak anything.
- `/wsl job <pid> <log>` watches the group leader, while `/wsl job stop <pid>`
  watches the whole group. The asymmetry is deliberate: status answers whether
  the launched body finished, and stop has to catch a child that outlived the
  leader. Changing status to the group form would report a finished job as
  running for as long as any stray grandchild lived.

## 0.3.8 - 2026-09-28

A detached job can now be judged after it ends.

### Fixed

- A background job records its exit status in a `.rc` file beside the log and
  reports the path as `RC=` in the handle, so `/wsl job <pid> <log>` can show
  `Exit:` once the job has stopped. Before this, a job that ended after the
  handoff reported its output through the log but its exit code was never
  recoverable.
- A job that ends inside the handoff window is reported inline with its real
  exit code again. `kill -0` still succeeds on a child the parent has not reaped,
  so a job that failed instantly could be handed back as a live PID.

## 0.3.7 - 2026-09-28

Long jobs, root commands, and two-way path mapping join the tool, and the Windows host no longer freezes while WSL starts.

### Added

- Detached commands. `background: true` returns a PID and log path, with an optional `log` to choose one. A job that exits during the handoff reports its own output and exit code instead of a handle.
- `user` runs a command as a named WSL account, so system work no longer needs `sudo` and a password.
- `/wsl status` reports distro, user, systemd, automount root, IP, and WSL version in one call. `/wsl job <pid> <log>` shows a detached job's state and recent output.
- `/wsl path` now maps Linux paths back to `//wsl.localhost/<distro>/...`, which `read`, `write`, and `edit` accept.
- A `pi-wsl` skill ships with the package with the routing rules, job workflow, and known traps.

### Changed

- WSL startup and path probes run asynchronously, so the Pi TUI no longer blocks while a distro boots. Drive mounts are cached and each named distro wakes separately.
- A stopped call now reads `aborted` or `timed out after Nms` instead of a misleading timeout line. Timeouts outside 1 to 3600 seconds are rejected.
- Shell scripts keep their own path unless they carry CRLF, which previously moved every script to a temp copy and broke script-relative file reads. A CRLF copy is now taken beside the source and trashed on exit, including after a failure.

### Fixed

- `wsl -l` output that arrives as UTF-16 text with NUL padding, and the default-distro `*` marker, are decoded and stripped. Windows error text from a bad distro name is readable, and the tool lists the installed names.

## 0.3.6 - 2026-09-20

- Fix a TUI crash when a running command prints CJK or emoji output wider than the terminal. Rows now measure and truncate with the Pi TUI width helpers, so status and output lines always fit (fixes #1, PR #2 by @Ckrvxr).

## 0.3.5 - 2026-08-16

- Publish the README with LF line endings so npmjs.com renders it. Windows CRLF made the site show an empty README.

## 0.3.4 - 2026-08-16

- Drop the dead `s` / `c` / `p` hints and the expand/close chip. The last `>` line is output only.
- A thrown theme color in the custom renderer now prints an error line instead of taking down the TUI.

## 0.3.3 - 2026-08-16

- When the row is stalled or killed, the icon and WSL/distro mark use that warning or error color.

## 0.3.2 - 2026-08-16

### Added

- TUI row inside the green box: icon + bold WSL (or the distro name when set) and the user command on the left, exit and elapsed time on the right. Long commands truncate with `…`.
- Output uses `>` (stderr `!`) with a braille spinner while running.
- Hint bar (`s` / `c` / `p` / expand) is right-aligned on the last `>` line.
- Yellow when no output arrives for 15s (`PI_WSL_STALL_WARN` in seconds). Red on fail, timeout, or kill.

## 0.3.1 - 2026-08-16

### Added

- Drive-letter paths go through `wslpath -u` when WSL is up, so a custom `automount.root` still maps. Linux and UNC paths stay on the local mapper.
- If this WSL build has no `--cd`, the command is prefixed with `cd -- <dir> &&`.
- First call wakes the distro with `wsl.exe -- true` so a cold start does not eat the whole timeout.
- `/wsl path <p>` prints the mapped Linux path.

## 0.3.0 - 2026-08-16

### Added

- On Win11 (not inside WSL), block builtin `bash` when the command would be rewritten by Git Bash (`/mnt/<drive>`, `\\wsl.localhost`, eaten UNC, `wsl -d`, `MSYS_NO_PATHCONV`, `/home/`). The reason tells the model to call the `wsl` tool with the raw command. Does not re-run the command.
- Same intercept for `read` / `write` / `edit` on WSL UNC or `/mnt/<drive>` paths.
- Set `PI_WSL_NO_INTERCEPT=true` to turn the hook off.

## 0.2.1 - 2026-08-16

npm package name is `@apoapostolov/pi-wsl`. Unscoped `pi-wsl` is blocked as too similar to `is-wsl`.

### Added

- `/wsl distros` lists installed distros via the existing UTF-16LE `wsl -l` decoder. Also accepts `distro`, `list`, and `-l`

## 0.2.0 - 2026-08-16

Ideas taken from `@bacnh85/pi-windows-tools`, kept on the WSL job.

### Added

- Distro from a UNC cwd or script (`\\wsl.localhost\Debian\...` picks Debian). Explicit `distro` still wins, then UNC, then `WSL_DISTRO`
- Git Bash `/c/foo` maps to `/mnt/c/foo`. `/dev` and `/home` stay Linux paths
- `\\?\` long-path prefix is stripped
- Timeout and abort kill the process tree with `taskkill /t /f`
- Live `onUpdate` stream while the command runs
- stdout and stderr stay separate in the result (`--- stdout ---` / `--- stderr ---`)
- Invalid-distro errors list installed distros. `wsl -l` UTF-16LE is decoded

## 0.1.0 - 2026-08-16

First public cut. Work in progress.

### Added

- `wsl` tool that spawn()s `System32\wsl.exe` and runs bash in WSL, so Git Bash never rewrites `/mnt/c`, `\\wsl.localhost`, or `$VARS`
- `/wsl <command>` shortcut
- Path repair for drive letters, `\\wsl.localhost`, `\\wsl$`, and the eaten `C:\wsl.localhost\...` form
- `script` plus `args` as a string or a quoted array. Array items that look like Windows/UNC paths are converted
- `env` passthrough, `input` for the command's stdin, `login`, default user-bus exports for `systemctl --user`
- Default CRLF handling for `script`: copy to `/tmp`, strip CR, run the copy
- Default distro is the user's WSL default. Override with `distro` or `WSL_DISTRO`
- Registers only on Windows or inside WSL
