# Notes for working on this repository

## Versioning (required on every commit)

Each program has its own version, `MAJOR.MINOR.PATCH`. Every commit that changes a program bumps
that program's version:

- **Fix or small change** (bug fix, wording, docs for that program): add `.0.1`, e.g. `2.0.0` → `2.0.1`.
- **New feature**: add `.1.0` and reset the last number, e.g. `2.0.3` → `2.1.0`.
- **Major version** (`2.x.x` → `3.0.0`): only when the owner says so. Never on your own.

One bump per program per commit, even if the commit has several fixes; a commit with a feature
and fixes is a feature bump. Only bump the programs the commit actually changes.

Where each version lives (change all of them together):

| Program | Files |
|---|---|
| Andromeda Hosting | `Andromeda Hosting/package.json`, `Andromeda Hosting/package-lock.json` (the top `version` and `packages[""].version`), `Andromeda Hosting/README.md` (line 3), the table in the root `README.md` |
| Andromeda WotLK Website | `Andromeda WotLK Website/package.json`, `Andromeda WotLK Website/package-lock.json` (same two places), `Andromeda WotLK Website/README.md` (line 3), the table in the root `README.md` |
| Andromeda Services Website | `Andromeda Services Website/package.json`, `Andromeda Services Website/README.md` (line 3), the table in the root `README.md` (no package-lock: it has no packages) |
| Andromeda Services (`services/`) | `[assembly: AssemblyVersion("X.Y.Z.0")]` in `services/AndromedaServices.cs`, the table in the root `README.md` |
| `install.exe` (`services/Installer.cs`) | `[assembly: AssemblyVersion("X.Y.Z.0")]` in `services/Installer.cs`. Bump it when `Installer.cs` changes or `install.exe` is rebuilt |

## Tests

- Andromeda Hosting: `cd "Andromeda Hosting" && npm test`
- Andromeda WotLK Website: `cd "Andromeda WotLK Website" && npm test`
- Andromeda Services Website: `cd "Andromeda Services Website" && npm test`
