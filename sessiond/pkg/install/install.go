// Package install writes the sessiond lifecycle hook entries into the user's
// Claude and Codex config files. It is intentionally narrow: callers set the
// apply flag; this package decides what each file should contain.
//
// Files are resolved from $HOME; symlinks (e.g. ~/.codex/config.toml pointing
// to a shared repo) are followed and surfaced with a warning so reviewers know
// the write touches the shared file, not just the per-user one.
package install

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Events registered per agent. Claude fires turn-level Stop / StopFailure /
// TaskCompleted; Codex fires Stop / SubagentStop. Every event routes to the
// same idempotent `sessiond hook <agent>`, so extra fires are harmless
// re-syncs.
var (
	claudeEvents = []string{"Stop", "StopFailure", "TaskCompleted"}
	codexEvents  = []string{"Stop", "SubagentStop"}
)

const (
	codexMarkerBegin = "# >>> superset sessiond hooks >>>"
	codexMarkerEnd   = "# <<< superset sessiond hooks <<<"
)

// Options is the dry-run/apply toggle plus optional I/O overrides (tests stub
// these to avoid touching the real $HOME).
type Options struct {
	Apply  bool
	Stdout io.Writer // default: os.Stdout
	Stderr io.Writer // default: os.Stderr
	Binary string    // default: this process's os.Executable()
	Home   string    // default: os.UserHomeDir()
}

// TargetStatus captures what happened to one config file. Returned per
// installer for callers that want a structured summary instead of stdout.
type TargetStatus struct {
	Path       string // real path (symlink resolved)
	Configured bool   // hooks block already present
	Changed    bool   // something new was added this run
	Written    bool   // file was actually written (false in dry-run)
	Skipped    string // reason if not Written even on --apply (e.g. shared-symlink guard)
}

// Run performs the install (or dry-run) and prints a human-readable summary to
// opts.Stdout. Errors writing individual targets are logged to opts.Stderr but
// do not abort the other target — install is best-effort per file.
func Run(opts Options) error {
	bin, err := resolveBinary(opts.Binary)
	if err != nil {
		return err
	}
	stdout, stderr := resolveIO(opts)
	home, err := resolveHome(opts.Home)
	if err != nil {
		return err
	}

	fmt.Fprintf(stdout, "binary: %s\n\n", bin)

	claudePath := filepath.Join(home, ".claude", "settings.json")
	codexPath := filepath.Join(home, ".codex", "config.toml")

	installClaude(stdout, stderr, claudePath, bin, opts.Apply)
	installCodex(stdout, stderr, codexPath, bin, opts.Apply)

	if !opts.Apply {
		fmt.Fprintln(stdout, "\n(dry-run) re-run with --apply to write these changes.")
	}
	return nil
}

// --- per-target installers ---

func installClaude(stdout, stderr io.Writer, path, bin string, apply bool) TargetStatus {
	real := resolveSymlink(path)
	cmd := bin + " hook claude"

	root := map[string]any{}
	if b, err := os.ReadFile(real); err == nil {
		_ = json.Unmarshal(b, &root)
	}
	hooks, _ := root["hooks"].(map[string]any)
	if hooks == nil {
		hooks = map[string]any{}
	}

	changed := false
	for _, ev := range claudeEvents {
		if hookHasCommand(hooks[ev], cmd) {
			continue
		}
		entry := map[string]any{"hooks": []any{map[string]any{"type": "command", "command": cmd}}}
		hooks[ev] = append(asSlice(hooks[ev]), entry)
		changed = true
	}
	root["hooks"] = hooks

	status := TargetStatus{Path: real, Changed: changed}
	fmt.Fprintf(stdout, "claude  %s\n  events: %s\n  command: %s\n", path, strings.Join(claudeEvents, ", "), cmd)
	if !changed {
		fmt.Fprintln(stdout, "  status: already registered")
		status.Configured = true
		return status
	}
	if !apply {
		fmt.Fprintln(stdout, "  status: would add (dry-run)")
		return status
	}
	if err := backup(real); err != nil {
		fmt.Fprintf(stderr, "claude backup: %v\n", err)
		status.Skipped = "backup failed: " + err.Error()
		return status
	}
	out, _ := json.MarshalIndent(root, "", "  ")
	if err := os.WriteFile(real, out, 0o644); err != nil {
		fmt.Fprintf(stderr, "claude write: %v\n", err)
		status.Skipped = "write failed: " + err.Error()
		return status
	}
	fmt.Fprintln(stdout, "  status: written")
	status.Written = true
	status.Configured = true
	return status
}

func installCodex(stdout, stderr io.Writer, path, bin string, apply bool) TargetStatus {
	real := resolveSymlink(path)
	cmd := bin + " hook codex"
	status := TargetStatus{Path: real}

	existing, _ := os.ReadFile(real)
	if strings.Contains(string(existing), codexMarkerBegin) {
		fmt.Fprintf(stdout, "codex   %s\n  status: already registered\n", real)
		status.Configured = true
		return status
	}

	block := codexHookBlock(cmd)
	fmt.Fprintf(stdout, "codex   %s\n  events: %s\n  command: %s\n", path, strings.Join(codexEvents, ", "), cmd)
	if real != path {
		fmt.Fprintf(stdout, "  note: config.toml is a symlink → %s (shared repo; review before --apply)\n", real)
	}
	if !apply {
		fmt.Fprintln(stdout, "  status: would append block (dry-run):")
		fmt.Fprintln(stdout, indent(block, "    "))
		status.Changed = true
		return status
	}
	if err := backup(real); err != nil {
		fmt.Fprintf(stderr, "codex backup: %v\n", err)
		status.Skipped = "backup failed: " + err.Error()
		return status
	}
	f, err := os.OpenFile(real, os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		fmt.Fprintf(stderr, "codex open: %v\n", err)
		status.Skipped = "open failed: " + err.Error()
		return status
	}
	defer f.Close()
	if _, err := f.WriteString("\n" + block); err != nil {
		fmt.Fprintf(stderr, "codex write: %v\n", err)
		status.Skipped = "write failed: " + err.Error()
		return status
	}
	fmt.Fprintln(stdout, "  status: appended")
	status.Changed = true
	status.Written = true
	status.Configured = true
	return status
}

// --- small helpers (unchanged logic, exported only via Run) ---

func codexHookBlock(cmd string) string {
	var b strings.Builder
	b.WriteString(codexMarkerBegin + "\n")
	for _, ev := range codexEvents {
		fmt.Fprintf(&b, "[[hooks.%s]]\n", ev)
		fmt.Fprintf(&b, "[[hooks.%s.hooks]]\n", ev)
		b.WriteString("type = \"command\"\n")
		fmt.Fprintf(&b, "command = %q\n", cmd)
	}
	b.WriteString(codexMarkerEnd + "\n")
	return b.String()
}

func hookHasCommand(entries any, cmd string) bool {
	for _, e := range asSlice(entries) {
		m, ok := e.(map[string]any)
		if !ok {
			continue
		}
		for _, h := range asSlice(m["hooks"]) {
			hm, ok := h.(map[string]any)
			if ok && hm["command"] == cmd {
				return true
			}
		}
	}
	return false
}

func asSlice(v any) []any {
	if s, ok := v.([]any); ok {
		return s
	}
	return nil
}

func backup(path string) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil // nothing to back up
	}
	bak := fmt.Sprintf("%s.bak.%d", path, time.Now().Unix())
	return os.WriteFile(bak, b, 0o644)
}

func resolveSymlink(path string) string {
	if real, err := filepath.EvalSymlinks(path); err == nil {
		return real
	}
	return path
}

func resolveBinary(override string) (string, error) {
	if override != "" {
		return filepath.Abs(override)
	}
	bin, err := os.Executable()
	if err != nil {
		return "", err
	}
	return filepath.Abs(bin)
}

func resolveHome(override string) (string, error) {
	if override != "" {
		return override, nil
	}
	return os.UserHomeDir()
}

func resolveIO(opts Options) (io.Writer, io.Writer) {
	out, err := opts.Stdout, opts.Stderr
	if out == nil {
		out = os.Stdout
	}
	if err == nil {
		err = os.Stderr
	}
	return out, err
}

func indent(s, pad string) string {
	lines := strings.Split(strings.TrimRight(s, "\n"), "\n")
	for i := range lines {
		lines[i] = pad + lines[i]
	}
	return strings.Join(lines, "\n")
}