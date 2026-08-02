# Disk Usage Status Bar

## Scope

`diskUsagePlugin` owns a dedicated right-aligned Status Bar Item showing the
disk usage of the volume that contains Superset's `Current Workspace Root`.
It does not calculate the size of the workspace folder itself.

## Behaviour

- Read the volume capacity with Node `fs.promises.statfs`.
- Display compact text in the form `$(database) Disk <used-percent>%`.
- The tooltip includes the workspace path, used bytes, free bytes, and total
  bytes.
- Refresh immediately at activation and every 30 seconds afterwards.
- On a `statfs` failure, keep the Status Bar Item visible as `Disk —` and put
  the error message in its tooltip.
- Stop the refresh timer before disposing the Status Bar Item during plugin
  teardown.

## Ownership and verification

Capacity math and user-facing strings live in `src/diskUsage/usage.ts` and are
covered by `test/diskUsage.test.ts`. VS Code lifecycle and refresh scheduling
live in `src/diskUsage/plugin.ts` and are covered by
`test/diskUsagePlugin.test.ts`.
