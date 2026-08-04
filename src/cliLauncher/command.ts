// CLI Launcher 的 agent 命令與 shell 字串組裝 (pure)。
//
// terminal 有可能被重用 (cwd 已經飄走),所以每次送出的命令都自帶 `cd`,
// 不倚賴 terminal 建立當下的 cwd。這裡全部是純字串運算,可直接單元測試。

/** 側邊面板每一列固定提供的三顆 agent 按鈕。 */
export const AGENT_IDS = ["claude", "codex", "grok"] as const;

export type AgentId = (typeof AGENT_IDS)[number];

export type AgentCommands = Record<AgentId, string>;

/**
 * 預設就是同名 CLI;使用者可用 `superset.cliLauncher.agentCommands` 覆寫成
 * 含旗標的命令。
 */
export const DEFAULT_AGENT_COMMANDS: AgentCommands = {
    claude: "claude",
    codex: "codex",
    grok: "grok",
};

/** 只接受字串且非空白的覆寫值,其餘一律 fallback 回預設命令。 */
export function resolveAgentCommands(raw: unknown): AgentCommands {
    const overrides =
        typeof raw === "object" && raw !== null
            ? (raw as Record<string, unknown>)
            : {};

    const resolved = { ...DEFAULT_AGENT_COMMANDS };
    for (const agent of AGENT_IDS) {
        const value = overrides[agent];
        if (typeof value === "string" && value.trim() !== "") {
            resolved[agent] = value.trim();
        }
    }
    return resolved;
}

/**
 * 以 POSIX single quote 包裝路徑。單引號內部除了 `'` 本身之外沒有任何跳脫,
 * 因此把 `'` 換成 `'\''` 是唯一安全的作法 —— 路徑含空白或 `$` 都不會被展開。
 */
export function quoteShellPath(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * 組出 terminal 要送出的整行命令。沒有命令時只做 `cd`,讓使用者拿到一個
 * 已經停在正確目錄的空 shell。
 */
export function buildShellCommand(cwd: string, command: string): string {
    const cd = `cd ${quoteShellPath(cwd)}`;
    const trimmed = command.trim();
    return trimmed === "" ? cd : `${cd} && ${trimmed}`;
}

/**
 * terminal 顯示名稱。同一個 (label, agent) 組合固定同名,launch 層據此重用
 * 既有 terminal,避免每按一次就長出一個新分頁。
 */
export function terminalNameFor(label: string, agent?: AgentId): string {
    return agent ? `${label} · ${agent}` : label;
}
