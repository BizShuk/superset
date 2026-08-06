# Unified Plugin Lifecycle 與 Live Diagnostics

## 狀態

已實作於 `0.40.0`。

## 使用者行為

- `Superset: Reset Caches` 清除 workspace cache 後，會依序執行每個 active plugin 的 reset handler。
- `Superset: Open Settings` 開啟 VS Code native Settings，並只顯示 Superset extension settings。
- `Superset: Show Diagnostics` 顯示當下 active plugins、tracked/unseen terminals、mDNS services 與 workspace TODO tasks。
- Provider 缺席時顯示 `Unavailable`，不以假 `0` 代替；provider 回傳的真實 `0` 保留為 `0`。
- 單一 subsystem 無法產生 diagnostics 時，其餘 subsystem 仍正常顯示，錯誤寫入 Diagnostic Logs。

## Architecture Contract

- 所有 feature 直接實作 `ExtensionPlugin` 並接受單一 `PluginContext`，不保留第二套 feature lifecycle。
- `PluginManager` 依 plugin owner 管理 disposable、reset handler、Tree View registration 與 diagnostics provider。
- Composition root 注入 diagnostic log、Tree View registry 與 native terminal creation capability；feature 不透過 module-level getter/setter 交換跨 domain state。
- Terminal creation 的唯一 VS Code API boundary 仍是 `createNativeTerminal`。
- Diagnostics provider 是 read-only live query，不建立第二份 cached subsystem state。
- TODO count 遞迴計算所有 checkbox tasks，不計 bare-list note、section 或 plan row。

## 移除的 Obsolete Paths

- Legacy `FeatureContext` / `FeatureHandle` contract。
- Legacy plugin adapter 與 feature-context bridge。
- Diagnostic channel、PluginManager、Tree View registry 與 terminal spawner 的 ambient singleton bridge。
- Command catalog Markdown 形式的 Settings page 與 diagnostics placeholder count。
- 未被 runtime 使用的 persistent plugin failure marker。

## Verification Boundary

- Unit/contract tests 覆蓋 lifecycle ownership、reset fan-out、diagnostics aggregation、provider failure isolation、native Settings routing 與 obsolete import boundary。
- TypeScript compile、完整 Vitest suite 與 VSIX build/verification 是 release gate。
- Native Settings 與 Markdown preview 的 Extension Development Host visual acceptance 仍屬 manual gate。

## Non-goal

Sessions View 是否納入 Panel Layout restore 不在本次變更範圍。
