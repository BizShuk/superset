# Superset Security Hardening Implementation Plan

> For agentic workers: execute inline with `systematic-debugging`,
> `test-driven-development`, and `verification-before-completion`. Do not
> commit; preserve unrelated workspace changes.

`Goal:` Close the remaining security findings from the 2026-07-27 review:
prevent mDNS-originated shell injection and unbounded state, guarantee plugin
teardown, redact terminal payloads from diagnostics, and reduce GitHub Release
token/supply-chain exposure.

`Architecture:` Keep untrusted mDNS data in pure domain functions until it has
passed strict validation. Represent browser connections separately from
terminal commands, quote every terminal argument at the shell boundary, bound
each network-controlled collection, and make the composition root own
deactivation. Keep security contracts executable through focused Vitest tests
and the existing VSIX verifier.

`Tech Stack:` TypeScript 5, VS Code Extension API, Vitest, Bash, GitHub Actions.

## Global Constraints

- Preserve the VS Code baseline `^1.93.0` and Node.js baseline `>=20.0.0`.
- Keep `node-pty@^1.1.0`; do not alter the PTY backpressure model.
- Keep command IDs and user-facing feature names stable.
- Update `package.json` and `package-lock.json` together to `0.22.9`; the
  original `0.22.7` target was superseded after the autostash reapplied on top
  of existing `v0.22.7` and `v0.22.8` tags.
- Keep `README.md`, `CLAUDE.md`, and a new dated spec aligned with the code.
- Do not commit.

---

### Task 1: Safe mDNS Connect boundary

`Files:`

- Create: `src/shellCommand.ts`
- Modify: `src/spawnRunTerminal.ts`
- Modify: `src/mdnsConnect.ts`
- Modify: `src/mdns/index.ts`
- Test: `test/mdnsConnect.test.ts`
- Test: `test/shellCommand.test.ts`

`Interfaces:`

- `quoteShellArg(value: string): string`
- `joinShellCommand(command: string, args: readonly string[]): string`
- `resolveConnectCommand(service): ConnectAction | null`
- `ConnectAction = TerminalConnectAction | ExternalConnectAction`

- [x] Add failing tests showing that shell metacharacters, newlines, leading
  option-like usernames, invalid hosts, and invalid ports are rejected.
- [x] Add failing tests showing HTTP/IPP actions return an `external` URI and
  SSH actions return a `terminal` argv plan.
- [x] Add a failing test proving `joinShellCommand("ssh", ["pi@nas.local"])`
  quotes the argument and neutralizes embedded single quotes.
- [x] Run
  `npx vitest run test/mdnsConnect.test.ts test/shellCommand.test.ts`; confirm
  the new action shape/helper tests fail because the behavior is absent.
- [x] Implement DNS/IP/username/port validation in `src/mdnsConnect.ts`.
- [x] Route external actions through
  `vscode.env.openExternal(vscode.Uri.parse(action.uri, true))`; route SSH
  through `joinShellCommand()` before `terminal.sendText()`.
- [x] Re-run the focused tests and confirm they pass.

### Task 2: Deterministic plugin teardown

`Files:`

- Modify: `src/extension.ts`
- Modify: `src/plugin/manager.ts`
- Modify: `src/plugin/treeViewRegistry.ts`
- Modify: `src/crossModuleState/diagnosticChannel.ts`
- Modify: `src/terminals/index.ts`
- Test: `test/extensionActivate.test.ts`
- Test: `test/pluginManager.test.ts`
- Test: `test/terminalsPlugin.test.ts`

`Interfaces:`

- Root `deactivate(): Promise<void>` clears root singletons and awaits
  `PluginManager.deactivateAll()`.
- A plugin that throws during activation has every already-registered
  disposable released immediately.

- [x] Add a failing manager test where a plugin registers a disposable and then
  throws; assert the disposable is called once and no failed-plugin pool
  remains.
- [x] Replace the no-op extension test with a failing assertion that
  `deactivate()` removes registered commands and is idempotent.
- [x] Add a failing terminal lifecycle assertion that manager-driven disposal
  clears the cross-module terminal spawner.
- [x] Run the three focused test files and confirm the teardown assertions fail
  against the current no-op root.
- [x] Retain the active manager in `src/extension.ts`, await teardown, clear
  singleton references, and register the diagnostic channel with the VS Code
  extension context.
- [x] Dispose partial activation pools in `PluginManager.activateAll()`.
- [x] Add a terminal-spawner cleanup disposable to the terminal plugin pool.
- [x] Re-run focused tests and confirm they pass.

### Task 3: Bound all mDNS-controlled state

`Files:`

- Create: `src/mdns/limits.ts`
- Modify: `src/mdns/mdnsRegistry.ts`
- Modify: `src/mdns/store.ts`
- Modify: `src/mdns/parser.ts`
- Modify: `src/mdns/mdnsDedup.ts`
- Modify: `src/mdns/expiration.ts`
- Test: `test/mdnsRegistry.test.ts`
- Test: `test/mdnsStore.test.ts`
- Test: `test/mdnsParser.test.ts`
- Test: `test/mdnsDedup.test.ts`
- Test: `test/mdnsRegistry.expiration.test.ts`

`Interfaces:`

- At most `256` records are processed per packet.
- At most `512` pending and `512` stored services are retained.
- DNS names are at most `255` UTF-8 bytes; each service retains at most `32`
  aliases, addresses, subtypes, and `64` TXT entries.
- TXT keys are at most `128` bytes and values at most `1024` bytes.
- Effective expiration TTL is clamped to `1..4500` seconds, with invalid/zero
  values using the existing `120` second default.

- [x] Add failing tests for fixed-window coalescing under continuous packets,
  pending/store caps, packet-record caps, bounded arrays/TXT, overlong DNS
  fields, and TTL clamping.
- [x] Run the five focused mDNS test files and confirm each new assertion fails
  for the expected missing bound.
- [x] Implement exported constants and UTF-8 length validation in
  `src/mdns/limits.ts`.
- [x] Stop resetting an existing coalesce timer; unref it and clear pending
  state during stop.
- [x] Enforce packet/pending/store caps and oldest-service eviction.
- [x] Enforce parser and merge collection limits, and clamp expiration TTL.
- [x] Re-run all focused mDNS tests and confirm they pass.

### Task 4: Redact terminal diagnostic payloads

`Files:`

- Modify: `src/terminals/shellIntegrationActivitySource.ts`
- Modify: `src/terminals/shellExecutionSource.ts`
- Test: `test/shellIntegrationActivitySource.test.ts`
- Create: `test/shellExecutionSource.test.ts`

`Interfaces:`

- Activity reasons contain only lifecycle edge and optional exit code.
- Legacy byte-watcher logs contain lifecycle metadata and byte count, never
  terminal name, command text, output bytes, or thrown error payload.

- [x] Change the existing activity-source tests to assert a sentinel secret is
  absent from every reason.
- [x] Add a mocked VS Code execution-source test that supplies a secret command
  and secret output, then asserts neither appears in diagnostic logs.
- [x] Run both focused files and confirm the current payload-logging
  implementation fails.
- [x] Remove command summarization and output serialization while retaining
  lifecycle metadata and byte counts.
- [x] Re-run focused tests and confirm they pass.

### Task 5: Least-privilege release workflow

`Files:`

- Modify: `.github/workflows/release.yml`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `test/releaseWorkflow.test.ts`

`Interfaces:`

- Default workflow permission is `contents: read`.
- The build job has no write token and checks out with
  `persist-credentials: false`.
- The release job alone has `contents: write`.
- `@vscode/vsce@3.9.2` is an exact devDependency resolved through the
  lockfile; build never downloads an unpinned `npx` package.
- Official Actions are pinned to these immutable v4 SHAs:
  `checkout@11d5960a326750d5838078e36cf38b85af677262`,
  `setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020`,
  `upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02`,
  `download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093`.

- [x] Add failing workflow contract tests for read-by-default permissions,
  job-level release write permission, full-SHA action pins, disabled persisted
  checkout credentials, and build/release artifact separation.
- [x] Run `npx vitest run test/releaseWorkflow.test.ts` and confirm failure.
- [x] Split the workflow into build and release jobs linked by a one-day
  `superset-vsix` artifact.
- [x] Change `npm run build` from `npm install` to `npm ci`.
- [x] Pin `@vscode/vsce@3.9.2` in the manifest and lockfile.
- [x] Bump both package manifests to `0.22.9`.
- [x] Re-run the workflow contract test and confirm it passes.

### Task 6: Documentation and full verification

`Files:`

- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/terminology.md`
- Modify: `.githooks/pre-push`
- Modify: `pkg/resources/git/githooks/pre-push`
- Create: `docs/specs/2026-07-27-security-hardening.md`

- [x] Update only the verified mDNS Connect, resource-bound, diagnostic,
  lifecycle, build, and release statements.
- [x] Run `npm test` and require zero failures.
- [x] Run `npm run build`; inspect the generated VSIX verifier result.
- [x] Run `npm audit --json`, `shellcheck` on repository shell scripts, and
  `git diff --check`.
- [x] Inspect `git status` and the final diff; leave all changes uncommitted.
