# Changelog

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
