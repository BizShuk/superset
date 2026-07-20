# sessiond

跨 agent session 摘要 ingestor。由 `Claude Code` 與 `Codex` 的 lifecycle hook 觸發,
把每個 turn 濃縮成一行摘要,append 到 per-session JSONL,供 `superset` VSCode side panel 讀取。

獨立 Go module(`github.com/bizshuk/sessiond`),import 框架層 `gosdk`(config/data dir)。
`gemma` 摘要(`agentSDK provider/google`)為後續階段;目前用零成本 heuristic(取 user prompt)。

## 用法 (Usage)

```bash
sessiond hook <claude|codex>  # 由 lifecycle hook 呼叫,讀 stdin JSON,exit 0
sessiond install             # dry-run 預覽要註冊的 hook 設定
sessiond install --apply     # 實際寫入(自動備份 + symlink 警告)
sessiond --version
```

子命令採 cobra 風格(spf13/cobra)。`hook` 永遠 `exit 0`,任何錯誤只 log stderr,絕不阻擋 agent。

hook 是 best-effort:任何錯誤只寫 stderr 並 `exit 0`,絕不阻擋或拖慢 agent(`exit 2` 會 block Claude 的 Stop)。

## 輸出契約 (Storage contract)

```tree
~/.config/superset/data/sessions/<%2F-encoded-workspace>/<session_id>.jsonl
```

- 第一行 `{"type":"meta",...}`:agent / session_id / workspace_path / title / resume / schema_version。
- 其餘每行 `{"type":"turn",...}`:index / event / user / summary / source / status / at。
- `Sync` 冪等:重複 hook 觸發(Stop、SubagentStop、retry)只 append 新 turn,不重複、不重寫 meta。
- workspace 以 `%2F` 可逆編碼為`單一目錄段`(Grok 風格),一次 readdir 即列出該 workspace 所有 session。

## 觸發機制 (Hook wiring)

兩家都是 `JSON-over-stdin`。`install-hooks` 註冊:

| Agent | 設定檔 | events |
| --- | --- | --- |
| Claude | `~/.claude/settings.json` (`hooks`) | `Stop` / `StopFailure` / `TaskCompleted` |
| Codex | `~/.codex/config.toml` (`[[hooks.*]]`) | `Stop` / `SubagentStop` |

所有 event 都指向同一個冪等 `sessiond hook <agent>`,多觸發只是無害 re-sync。
hook payload 提供 `session_id` / `transcript_path` / `cwd` / `hook_event_name`;實際 turn 內容一律
`從 transcript 檔重讀`(source of truth),不依賴 payload 文字。

- Claude turn 來源:transcript JSONL 的 `type:user/assistant`(濾 sidechain / tool_result / caveat)。
- Codex turn 來源:rollout JSONL 的 `event_msg` `user_message`/`agent_message`(濾 AGENTS.md / plugins / permissions 注入)。

## 開發 (Dev)

```bash
go test ./...     # ingest parser + store 冪等 純函式測試
go build -o ~/.local/bin/sessiond .
```

`replace github.com/bizshuk/gosdk => /Users/shuk/projects/tmp/gosdk`(gosdk 未 tag 前走本地 checkout)。

## 摘要後端 (Summarizer)

無 `GOOGLE_API_KEY` 時用 heuristic(取 user prompt);有 key 時自動切 `gemma`(`agentSDK provider/google`),
失敗/逾時/空回覆自動降級 heuristic。只摘要`新增`的 turn(每次 hook 約 1 次 LLM 呼叫)。

| env | 預設 | 用途 |
| --- | --- | --- |
| `GOOGLE_API_KEY` | — | 設了才啟用 gemma |
| `SUPERSET_SUMMARIZER_MODEL` | `gemma-3-27b-it`(暫定,需 verify) | gemma model id |
| `SUPERSET_SUMMARIZER` | — | 設 `heuristic` 可強制關閉 gemma |

## 狀態 (Status)

- ✅ Claude hook + Codex hook ingest → JSONL(冪等,只摘要新增 turn)
- ✅ `gemma` 摘要後端(`internal/summarize/gemini.go`);加 `GOOGLE_API_KEY` 即生效,否則 heuristic
- ⏸ VSCode `superset/src/sessions/`:讀本契約 + TreeView + resume-in-terminal

設計全文見 [`../plans/2026-07-19-multi-agent-session-summary.md`](../plans/2026-07-19-multi-agent-session-summary.md)。
