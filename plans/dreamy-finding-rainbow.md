# superset-pty — terminal-listening PoC plan

## Context

The recent v0.18.0 PTY data pipeline refresh (`9c08492`) made `PtyTerminalHost.onWrite` and `onClose` first-class multi-listener fan-outs (write/close `Set<...>` callbacks exposed publicly). The user's theory is that these hooks are enough — or with one small additional wire — to **hear every terminal in a single VS Code window** from outside the extension process. Validating that theory opens the door to a standalone `superset-pty` CLI that can stream live PTY data: useful for cross-window observation, recording, and external automation.

Why a PoC: confirming the theory cheaply (one branch, a few hundred lines, two test files) before committing to a wider `tools/superset-pty` repo or feature flag.

Two data paths exist in the codebase and the tap must cover both:

1. **PTY-backed terminals** (Superset-owned via `PtyTerminalFactory`) — `PtyTerminalHost.onWrite` + `onClose` already expose the raw bytes.
2. **Non-PTY Shell Integration terminals** (everything else with integration enabled) — `createShellExecutionChunkFanOut` is **already defined** in [`src/terminals/shellExecutionSource.ts:80-126`](file:///Users/shuk/projects/platform/superset/src/terminals/shellExecutionSource.ts) and explicitly documented as the seam "the fan-out must attach to the event source **before** OutputWatcher and re-broadcast the data to additional subscribers" — but it is **never wired anywhere today**. The PoC will wire it.

The third category — plain `vscode.Terminal` without shell integration — has no readable output API in VS Code; that's a VS Code gap, not ours. The theory ("hear all terminals") is satisfied for both paths that can be satisfied.

## Goal

- Branch off `master` (currently `9c08492`).
- Wire a single `PtyTap` instance that subscribes to both data paths and publishes NDJSON frames over a per-window Unix domain socket.
- Ship an in-repo `bin/superset-pty.mjs` Node CLI that connects and prints frames.
- Validate the theory with unit tests + a manual smoke test.

## Architecture

```tree
                      ┌────────────────────────────────┐
                      │  VS Code Window (1 ext host)   │
                      │                                │
   PtyTerminalFactory │  ┌─ PtyTerminalHost #1 ──┐    │
   ─────────────────► │  │  onWrite / onClose    │──┐ │
                      │  └────────────────────────┘  │ │
                      │  ┌─ PtyTerminalHost #N ──┐  │ │
                      │  │  onWrite / onClose    │──┤ │
                      │  └────────────────────────┘  │ │
                      │                                │
   createShellExec    │  ┌─ shell-exec fan-out ────┐ │ │
   ChunkFanOut        │  │  execution.read() drain │─┤ │
   ─────────────────► │  └─────────────────────────┘ │ │
                      │           │                    │
                      │           ▼                    │
                      │  ┌──────────────┐              │
                      │  │   PtyTap     │  NDJSON      │
                      │  │  (in-memory  │  frames      │
                      │  │   router)    │──────────┐   │
                      │  └──────────────┘          │   │
                      │           │                 │   │
                      │           ▼                 │   │
                      │  ┌──────────────────────┐   │   │
                      │  │ net.createServer()   │   │   │
                      │  │ ~/.config/superset/  │◄──┼───┘
                      │  │ pty/<sid>-<pid>.sock │   │
                      │  └──────────────────────┘   │
                      └────────────────┬─────────────┘
                                       │ Unix socket
                                       ▼
                              ┌─────────────────────┐
                              │ bin/superset-pty.mjs│
                              │  (Node CLI)         │
                              │   prints NDJSON or  │
                              │   raw bytes to stdout│
                              └─────────────────────┘
```

### Key facts from exploration (used to avoid re-deriving)

- `crossModuleState/` publishes singletons, no generic EventEmitter — direct module wiring is the right shape here.
- `~/.config/superset/...` is hard-coded only in `src/sessions/store.ts:35-52`; no shared helper exists. The PoC will duplicate the `homedir() + .config/superset` join (acceptable for a PoC; extract later if needed).
- `node:net` `createServer({ path })` and `net.connect({ path })` are native and supported under `engines.node >= 20.0.0`. **No new dependencies.**
- `createShellExecutionChunkFanOut` already exists and is the prepared seam.
- `PtyTerminalHost` has zero `vscode` imports; pure tests for the tap router run without mocks.
- Test convention: `test/<unit>.test.ts` / `test/<unit>.<aspect>.test.ts`, vitest `4.1.9`, `vi.useFakeTimers()` precedent in `test/ptyTerminalHost.coalescing.test.ts`.

## File changes

### New files

| Path | Purpose |
| --- | --- |
| `src/terminals/ptyTap.ts` | Pure (no `vscode` import) in-memory router. Accepts `onWrite` / `onClose` subscriptions from `PtyTerminalHost` instances and `subscribe` from the shell-exec fan-out, frames events, dispatches to a `FrameSink`. Tracks an internal `id → { name, kind, openTs }` map. |
| `src/terminals/ptyTapServer.ts` | `net.createServer({ path })` wrapper. Accepts connections, writes NDJSON frames to all live sockets, backpressure-aware (pause on `socket.write` returning false, resume on `drain`). Cleans up dead sockets. Uses `vscode.env.sessionId` + `process.pid` for the socket path. |
| `bin/superset-pty.mjs` | Standalone Node CLI (ESM). `net.connect({ path })`, line-split, optional `--filter <regex>`, `--raw` (drop framing, print only the data chunks), `--socket <path>` (override), `--quiet` (suppress connect/disconnect logs). Friendly error when the socket is missing. |
| `test/ptyTap.test.ts` | Pure router tests: ID assignment, frame shape, sink dispatch, idempotent close. |
| `test/ptyTapServer.test.ts` | Real `net.createServer` on `os.tmpdir()/...sock`, connect a fake client socket, assert NDJSON framing + backpressure. |
| `test/binSupersetPty.test.ts` | Spawn `bin/superset-pty.mjs` against the test server with `--filter` and `--raw`, assert stdout. |

### Modified files

| Path | Change |
| --- | --- |
| `src/terminals/index.ts` | (1) Construct `PtyTap` and `PtyTapServer` after `PtyTerminalFactory` (around line 142, after the `setTerminalSpawner` call at 159). (2) Wrap `ptyFactory.spawn` so each new `PtyTerminalHost` is registered with the tap (replacing the bare `(name, cwd) => ptyFactory.spawn(name, cwd)` currently passed to `registerTerminalCommands`). (3) Wire `createShellExecutionChunkFanOut` before `OutputWatcher.start()` and subscribe it to the tap. (4) Push `ptyTapServer`, `ptyTap`, and the fan-out disposable into the existing `disposables` array at line 238–257. (5) Add a `superset.startPtyTap` / `superset.stopPtyTap` command pair (optional; gated by a `superset.ptyTap.enabled` setting) so users can opt in/out without restarting the window. |
| `package.json` | Add `superset.ptyTap.enabled` (boolean, default `false`) to the `configuration` block at line 32–55. Add `superset.startPtyTap` and `superset.stopPtyTap` commands. Add a `bin` field so `bin/superset-pty.mjs` is exposed when the package is installed (kept off for the PoC; CLI is runnable directly via `node bin/superset-pty.mjs`). |
| `docs/specs/` | (After merge) add `2026-07-24-feature-superset-pty.md` capturing the theory-validation outcome, frame format, and known limits. |

## Frame format (NDJSON, one JSON object per line)

```json
{"t":"meta","v":1,"sessionId":"<sid>","pid":12345,"ts":1732345678901}
{"t":"open","id":1,"name":"zsh","cwd":"/x","kind":"pty","ts":1732345679000}
{"t":"data","id":1,"chunk":"hello\r\n","ts":1732345679100}
{"t":"data","id":1,"chunk":"world\r\n","ts":1732345679200}
{"t":"open","id":2,"name":"bash","cwd":"/y","kind":"shell-exec","ts":1732345679500}
{"t":"data","id":2,"chunk":"$ ","ts":1732345679600}
{"t":"close","id":1,"code":0,"ts":1732345680000}
```

Notes:
- `kind` distinguishes PTY-backed (`pty`) from Shell Integration (`shell-exec`) so the consumer can filter.
- `ts` is `Date.now()` (wall clock); sequence is implicit in arrival order on a single socket connection.
- `chunk` is a JSON string; backslash and control bytes are escaped by `JSON.stringify`. No length cap — the tap coalesces downstream the same way `PtyTerminalHost` already coalesces chunks per `setImmediate`, so consumers see one `data` frame per coalesced flush.

## CLI surface (`bin/superset-pty.mjs`)

```
Usage: node bin/superset-pty.mjs [--socket PATH] [--filter REGEX]
                                [--raw] [--quiet]

Options:
  --socket PATH   Override socket path (default:
                  ~/.config/superset/pty/<sid>-<pid>.sock)
  --filter REGEX  Only emit frames whose terminal name matches REGEX
                  (matched against both `open.name` and the cached
                  name on subsequent frames)
  --raw           Drop framing; print only `data` chunk bytes
                  interleaved per terminal. Useful for piping into
                  `cat`, `tee`, or `less -R`.
  --quiet         Suppress the `[connected]` / `[disconnected]`
                  stderr banner.
```

Exit codes: `0` clean EOF / socket close, `1` socket missing (extension not running / tap disabled), `2` filter regex parse error.

## Out of scope (PoC)

- Replay / persistent log. If no CLI is connected, frames are dropped (no on-disk spool).
- Multi-window fan-in. Each VS Code window gets its own socket; the CLI connects to one at a time.
- Re-introducing the `dataListeners` Set on `PtyTerminalFactory` (already removed in `9c08492` for being zero-subscriber dead code). The tap lives as its own module, not a host on the factory.
- Windows named-pipe transport. Unix domain sockets only for the PoC; Windows is unsupported but documented.
- Extraction to `tools/superset-pty/` repo. Defer until the theory is validated and the wire format stabilizes.

## Verification

### Tests

```sh
npm test
```

Required green:
- `test/ptyTap.test.ts` — 6+ cases: ID assignment monotonicity, `meta` frame on first sink dispatch, frame shape (open/data/close), idempotent close, sink error isolation, missing `meta` re-emission after sink reconnect.
- `test/ptyTapServer.test.ts` — 4+ cases: NDJSON framing on a real socket, multi-client fan-out (frames go to both), backpressure (`socket.write` returns false → paused; `drain` event → resumed), dead-socket cleanup (`client.destroy()` mid-stream → server keeps serving).
- `test/binSupersetPty.test.ts` — 3+ cases: `--raw` mode strips `meta`/`open`/`close`, `--filter` regex only emits matching terminal, missing-socket exit code `1` with friendly stderr.

### Build

```sh
npm run build
```

Confirms TypeScript compile, VSIX packaging, and `bin/superset-pty.mjs` is bundled into the VSIX under `bin/` (per the existing `pkg/resources/` convention for runtime scripts).

### Manual smoke test (theory validation)

1. `npm run watch` in one terminal.
2. Launch the extension host (F5 in VS Code).
3. In a second terminal: `node bin/superset-pty.mjs --raw`.
4. In the VS Code window: open **Superset: New Terminal** 3 times, then in each run `cat large-file`, `vim foo.txt`, `htop`, and `claude` (or any TUI). Confirm every terminal's output appears in the CLI's stdout interleaved.
5. Kill one terminal. CLI should print nothing surprising (raw mode hides `close`); with default NDJSON mode, a `close` frame appears.
6. Disconnect the CLI and confirm the extension does not crash or leak (check `Superset` OutputChannel for `ptyTap` errors).
7. Restart the VS Code window and confirm a fresh socket path is used (no stale socket).

### Theory verdict

After steps 1–7:
- ✅ "Hear all terminals in a single VS Code window" holds for every PTY-backed terminal (the primary path) and every Shell Integration terminal (the secondary path, now wired via the prepared fan-out).
- ⚠ Plain non-PTY, non-shell-integration terminals are not observable by design of VS Code's API. Documented as a known limit.

## Critical files to read before implementing

- [`src/terminals/ptyTerminalHost.ts`](file:///Users/shuk/projects/platform/superset/src/terminals/ptyTerminalHost.ts) — the `onWrite` / `onClose` fan-out shape and the coalescing contract (frames arrive on `setImmediate` boundary, never mid-chunk).
- [`src/terminals/ptyTerminalFactory.ts`](file:///Users/shuk/projects/platform/superset/src/terminals/ptyTerminalFactory.ts) — single spawn seam to wrap.
- [`src/terminals/shellExecutionSource.ts`](file:///Users/shuk/projects/platform/superset/src/terminals/shellExecutionSource.ts) — the prepared `createShellExecutionChunkFanOut` (lines 80–126) to wire.
- [`src/terminals/index.ts`](file:///Users/shuk/projects/platform/superset/src/terminals/index.ts) — composition root where the tap slots in (around lines 142–159, 238–257).
- [`src/sessions/store.ts`](file:///Users/shuk/projects/platform/superset/src/sessions/store.ts) lines 35–52 — `homedir() + .config/superset` convention to mirror.
- [`test/ptyTerminalHost.coalescing.test.ts`](file:///Users/shuk/projects/platform/superset/test/ptyTerminalHost.coalescing.test.ts) — vitest pattern + `fakeProc()` helper to copy.

## Branch + version

- Branch: `test/superset-pty-listener` (matches user's "testing" framing; tracks `9c08492` master head).
- No version bump yet. Version bump happens at merge-to-master time alongside the `docs/specs/2026-07-24-feature-superset-pty.md` spec per the `CLAUDE.md` semantic-versioning rule.
