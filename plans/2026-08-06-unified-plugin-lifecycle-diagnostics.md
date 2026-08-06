# Unified Plugin Lifecycle and Live Diagnostics Implementation Plan

**Goal:** 修正 Reset Caches 與 Diagnostics 的失真行為，並將所有 feature 收斂到單一 `PluginContext` lifecycle。

**Architecture:** `PluginManager` 成為 plugin lifecycle、reset、runtime diagnostics、Tree View registry 與 terminal creation capability 的唯一協調者。Feature 直接註冊 disposable、reset handler 與 diagnostics provider，不再經過 legacy adapter 或 module-level cross-module state。

**Tech Stack:** TypeScript、VS Code Extension API、Vitest、npm、VSIX verification。

## Global Constraints

- [x] 保持 `src/extension.ts` 為 declarative composition root。
- [x] 保持 `src/terminals/nativeTerminal.ts#createNativeTerminal` 為唯一 terminal creation boundary。
- [x] 移除 obsolete compatibility path，不新增 fallback 或雙軌 lifecycle。
- [x] 每個 feature 只暴露自身 domain capability；跨 feature 協調由 `PluginContext` 完成。
- [x] 不修改 Sessions panel restore；此項依使用者要求 deferred。
- [x] 更新 package version，並同步維護 README、CLAUDE 與 dated spec。

## Task 1: 建立 Unified Runtime Contract 的失敗測試

**Files:**

- Modify: `test/pluginManager.test.ts`
- Create: `test/pluginArchitecture.test.ts`

- [x] 新增 reset、runtime diagnostics aggregation 與 provider failure isolation tests。
- [x] 新增 architecture contract，禁止 legacy adapter、`FeatureContext` 與 `crossModuleState` 回流。
- [x] 執行 focused tests，確認新 assertions 先以預期原因失敗。

## Task 2: 收斂 PluginManager 與 PluginContext

**Files:**

- Modify: `src/plugin/types.ts`
- Modify: `src/plugin/context.ts`
- Modify: `src/plugin/manager.ts`
- Modify: `src/plugin/treeViewRegistry.ts`
- Modify: `src/plugin/index.ts`
- Modify: `test/pluginManager.test.ts`
- Modify: `test/treeViewRegistry.test.ts`

- [x] 讓 manager 擁有 Tree View registry、reset handlers 與 diagnostics providers。
- [x] 將 log display、terminal creation、Tree View reveal 與 runtime snapshot 定義成 explicit context capabilities。
- [x] 讓 activation failure 與 teardown 同步清除所有 plugin-owned registration。
- [x] 移除未使用的 persistent plugin failure marker 與 ambient registry access。
- [x] 執行 plugin lifecycle focused tests，確認 contract 通過。

## Task 3: 遷移所有 Feature 到 Direct Plugin Lifecycle

**Files:**

- Modify: `src/cliLauncher/index.ts`
- Modify: `src/cliLauncher/plugin.ts`
- Modify: `src/git/index.ts`
- Modify: `src/git/plugin.ts`
- Modify: `src/mdns/index.ts`
- Modify: `src/mdns/plugin.ts`
- Modify: `src/sessions/index.ts`
- Modify: `src/sessions/plugin.ts`
- Modify: `src/terminals/index.ts`
- Modify: `src/terminals/plugin.ts`
- Modify: `src/todo/index.ts`
- Modify: `src/todo/plugin.ts`
- Modify: `src/topology/index.ts`
- Modify: `src/topology/plugin.ts`
- Delete: `src/shared.ts`
- Delete: `src/plugin/featureContext.ts`
- Delete: `src/plugin/legacyAdapter.ts`
- Modify: affected feature contract tests

- [x] 將七個 legacy plugin adapter 改為 direct `ExtensionPlugin`。
- [x] 將 disposable 與 reset registration 全部交給 manager-owned context。
- [x] 以 feature-owned diagnostics provider 提供 terminal、mDNS 與 TODO live counts。
- [x] 更新 lifecycle tests，確認 feature activation/deactivation 不再依賴 compatibility layer。

## Task 4: 移除 Module-Level Cross-Module State

**Files:**

- Modify: `src/extension.ts`
- Modify: `src/globalCommandsPlugin.ts`
- Modify: `src/installCommands.ts`
- Modify: `src/spawnRunTerminal.ts`
- Modify: affected Git、mDNS、terminal command registration files
- Delete: `src/crossModuleState/diagnosticChannel.ts`
- Delete: `src/crossModuleState/pluginManager.ts`
- Delete: `src/crossModuleState/terminalSpawner.ts`
- Delete: `src/crossModuleState/index.ts`
- Modify: affected activation and command tests

- [x] 由 composition root 建立並注入 log、Tree View registry 與 native terminal capability。
- [x] 將 reset、reveal、terminal spawn 與 log display 呼叫改成 explicit dependency flow。
- [x] 刪除 ambient getter/setter 與對應測試 assumptions。
- [x] 執行 activation、install command、terminal command focused tests。

## Task 5: 修正 Native Settings 與 Live Diagnostics

**Files:**

- Modify: `src/globalCommandsPlugin.ts`
- Modify: `src/diagnosticsPanel.ts`
- Delete: `src/diagnosticsPanel.types.ts`
- Modify: `test/globalCommandsPlugin.test.ts`
- Modify: `test/diagnosticsPanel.test.ts`
- Modify: feature diagnostics tests

- [x] `Open Settings` 直接開啟 VS Code native extension settings。
- [x] `Show Diagnostics` 顯示 active plugins 與 feature 提供的 live counts。
- [x] 對 diagnostics provider failure 採 fail-soft 並寫入 diagnostic log。
- [x] 移除 placeholder zeros、command catalog settings renderer 與 obsolete types。
- [x] 執行 diagnostics focused tests，確認 UI output 與 runtime state 一致。

## Task 6: 文件、Version 與完整驗證

**Files:**

- Modify: `README.md`
- Modify: `CLAUDE.md`
- Create: `docs/specs/2026-08-06-unified-plugin-lifecycle-live-diagnostics.md`
- Modify: `package.json`
- Modify: `package-lock.json`

- [x] 更新 business behavior、technical context 與 implemented design record。
- [x] 將 package version bump 為下一個 minor release。
- [x] 執行 `npm test`。
- [x] 執行 `npm exec tsc -- --noEmit`。
- [x] 執行 `npm run build`，確認 VSIX verification 通過。
- [x] 檢查 final diff、workspace status 與 deferred Sessions reminder。
