# Changelog

## 0.4.0 - 2026-08-16

### Added

- TUI status strip: distro, cwd, running/stalled/exit, elapsed time
- Yellow when no output arrives for 15s (`PI_WSL_STALL_WARN` in seconds). Red on fail, timeout, or kill
- Expanded result: `s` cycles stdout / stderr / both, `c` copies the unwrapped command, `p` copies the mapped cwd

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
