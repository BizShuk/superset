// CLI Launcher 的診斷輸出。
//
// 面板按鈕的失敗都發生在使用者的 IDE 裡,沒有 stack trace 可看。把每次命令
// 觸發、解析到的項目與實際送進 terminal 的字串寫進紀錄,「按了沒反應」就變成
// 可以直接讀出原因的日誌。
//
// Superset 只有一個由 composition root 持有的 "Superset" Output Channel
// (`Superset: Show Diagnostic Logs`),feature 不自建第二個 channel;這裡只是把
// Plugin activation 將 `ctx.log` 綁成 domain-local sink,讓 tree／terminal 等深層模組不必
// 一路把 logger 當參數傳下去。未綁定時 (單元測試) 是 no-op。

let sink: ((message: string) => void) | undefined;

/** 綁定共用 log sink;傳 `undefined` 解除綁定 (feature dispose 時)。 */
export function setCLILauncherLog(
    next: ((message: string) => void) | undefined
): void {
    sink = next;
}

export function log(message: string): void {
    sink?.(`[cliLauncher] ${message}`);
}
