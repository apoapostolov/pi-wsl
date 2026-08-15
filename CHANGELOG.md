# Changelog

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
