# Projects Setup Command

## Outcome

`Superset: Projects Setup` bootstraps the conventional BizShuk projects workspace from the VS Code Command Palette. The command creates `~/projects` when missing and ensures the expected aggregation repositories and their recursive Git submodules are present.

## Command Contract

| Field | Value |
| --- | --- |
| Command ID | `superset.projectsSetup` |
| Command title | `Superset: Projects Setup` |
| Projects root | `~/projects` |
| Clone transport | `https://github.com/<owner>/<repository>.git` |
| Runtime installer | `pkg/resources/config/setup-projects.sh` |

The root is a workspace convention and has no user-configurable override.

## Repository Set

Repositories are attempted in this order:

1. `bizshuk/env_setup`
2. `bizshuk/cc-plugin`
3. `bizshuk/ai`
4. `bizshuk/game`
5. `bizshuk/data`
6. `bizshuk/iphone`
7. `bizshuk/platform`
8. `bizshuk/playground`
9. `bizshuk/product`
10. `bizshuk/research`
11. `bizshuk/tools`
12. `bizshuk/web`

The runtime source of truth for this ordered set is `setup-projects.sh`.

## Setup Behavior

For each repository:

- Missing target: run `git clone --recurse-submodules <url> <target>`.
- Existing Git target: run `git submodule sync --recursive`, then `git submodule update --init --recursive`.
- Existing non-Git target: preserve it, record a failure, and continue with the remaining repositories.

Existing repositories are not pulled, reset, or overwritten. The script aggregates failures and exits non-zero only after attempting the complete set. The command uses `closeOnSuccess: true`, so its Run Terminal closes only when every repository succeeds and remains visible when diagnosis is needed.

## Architecture And Packaging

`src/installCommands.ts` resolves `~/projects`, invokes the bundled installer, and registers the command through `globalCommandsPlugin`. Repository iteration and Git behavior remain in the shell installer rather than the VS Code orchestration layer.

`scripts/verify-vsix.sh` requires the installer in the packaged extension. Tests cover command registration and dispatch, missing-root clone behavior, existing-repository submodule initialization, non-Git conflict continuation, and the packaged resource contract.
