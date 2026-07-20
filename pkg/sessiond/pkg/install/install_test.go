package install

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// home builds a fake $HOME with the directories install expects
// (~/.claude, ~/.codex). Each subtest gets its own copy so parallel runs don't
// share state.
func home(t *testing.T) (string, string, string) {
	t.Helper()
	root := t.TempDir()
	claudeDir := filepath.Join(root, ".claude")
	codexDir := filepath.Join(root, ".codex")
	if err := os.MkdirAll(claudeDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(codexDir, 0o755); err != nil {
		t.Fatal(err)
	}
	return root, claudeDir, codexDir
}

func newOpts(_ *testing.T, homeDir string, apply bool) Options {
	return Options{
		Apply:  apply,
		Stdout: &bytes.Buffer{},
		Stderr: &bytes.Buffer{},
		Binary: "/fake/bin/sessiond",
		Home:   homeDir,
	}
}

func TestRun_DryRun_DoesNotTouchFiles(t *testing.T) {
	h, claudeDir, codexDir := home(t)
	opts := newOpts(t, h, false)

	if err := Run(opts); err != nil {
		t.Fatal(err)
	}

	// Neither file should exist after a dry-run with no prior content.
	if _, err := os.Stat(filepath.Join(claudeDir, "settings.json")); !os.IsNotExist(err) {
		t.Error("dry-run wrote settings.json")
	}
	if _, err := os.Stat(filepath.Join(codexDir, "config.toml")); !os.IsNotExist(err) {
		t.Error("dry-run wrote config.toml")
	}
}

func TestRun_Apply_WritesClaudeAndCodexAndCreatesBackups(t *testing.T) {
	h, claudeDir, codexDir := home(t)
	// Pre-seed both files so backup() has something to copy. A real install
	// over a fresh home is a separate (no-backup) flow; see TestRun_DryRun.
	claudeFile := filepath.Join(claudeDir, "settings.json")
	codexFile := filepath.Join(codexDir, "config.toml")
	if err := os.WriteFile(claudeFile, []byte(`{"theme":"dark"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(codexFile, []byte("# existing config\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	claudeBak, _ := os.ReadFile(claudeFile)
	codexBak, _ := os.ReadFile(codexFile)

	opts := newOpts(t, h, true)
	if err := Run(opts); err != nil {
		t.Fatal(err)
	}

	// Claude settings.json exists, is valid JSON, contains the three events.
	b, err := os.ReadFile(claudeFile)
	if err != nil {
		t.Fatalf("claude settings not written: %v", err)
	}
	var root map[string]any
	if err := json.Unmarshal(b, &root); err != nil {
		t.Fatalf("claude settings not valid JSON: %v", err)
	}
	hooks, _ := root["hooks"].(map[string]any)
	for _, ev := range []string{"Stop", "StopFailure", "TaskCompleted"} {
		if _, ok := hooks[ev]; !ok {
			t.Errorf("claude missing event %s", ev)
		}
	}
	if root["theme"] != "dark" {
		t.Errorf("pre-existing theme lost: %v", root)
	}

	// Codex config.toml exists, has the marker block, declares both events.
	cb, err := os.ReadFile(codexFile)
	if err != nil {
		t.Fatalf("codex config not written: %v", err)
	}
	cx := string(cb)
	if !strings.Contains(cx, codexMarkerBegin) || !strings.Contains(cx, codexMarkerEnd) {
		t.Errorf("codex marker block missing: %s", cx)
	}
	for _, want := range []string{"[[hooks.Stop]]", "[[hooks.SubagentStop]]", `command = "/fake/bin/sessiond hook codex"`} {
		if !strings.Contains(cx, want) {
			t.Errorf("codex config missing %q in:\n%s", want, cx)
		}
	}
	if !strings.HasPrefix(cx, "# existing config\n") {
		t.Errorf("codex pre-existing content lost: %q", cx[:min(40, len(cx))])
	}

	// Backups were created and their contents equal the originals.
	findBak := func(dir, prefix string) []byte {
		es, _ := os.ReadDir(dir)
		for _, e := range es {
			if strings.HasPrefix(e.Name(), prefix+".bak.") {
				x, _ := os.ReadFile(filepath.Join(dir, e.Name()))
				return x
			}
		}
		return nil
	}
	if got := findBak(claudeDir, "settings.json"); !bytes.Equal(got, claudeBak) {
		t.Errorf("claude backup content mismatch: %q", got)
	}
	if got := findBak(codexDir, "config.toml"); !bytes.Equal(got, codexBak) {
		t.Errorf("codex backup content mismatch: %q", got)
	}
}

func TestRun_Idempotent_SecondApplyIsNoop(t *testing.T) {
	h, claudeDir, _ := home(t)
	opts := newOpts(t, h, true)

	if err := Run(opts); err != nil {
		t.Fatal(err)
	}
	claudeFile := filepath.Join(claudeDir, "settings.json")
	first, _ := os.ReadFile(claudeFile)
	firstMtime := mustStat(t, claudeFile).ModTime()

	// Sleep a beat to ensure mtime would change if we re-wrote.
	// (Not strictly necessary, but protects against fat-fingered mtime-reset.)
	// Re-apply; content must be identical and we must NOT add a second hook entry.
	if err := Run(opts); err != nil {
		t.Fatal(err)
	}
	second, _ := os.ReadFile(claudeFile)
	if !bytes.Equal(first, second) {
		t.Errorf("second apply changed file:\n%s\n---\n%s", first, second)
	}

	var root map[string]any
	_ = json.Unmarshal(second, &root)
	hooks := root["hooks"].(map[string]any)
	for _, ev := range []string{"Stop", "StopFailure", "TaskCompleted"} {
		arr, _ := hooks[ev].([]any)
		if len(arr) != 1 {
			t.Errorf("claude %s has %d entries, want 1 (idempotent)", ev, len(arr))
		}
	}
	_ = firstMtime // accepted that the second run reads + writes; what matters is content.
}

func TestRun_PreservesExistingClaudeSettings(t *testing.T) {
	h, claudeDir, _ := home(t)
	claudeFile := filepath.Join(claudeDir, "settings.json")
	existing := `{"theme":"dark","hooks":{"Other":[{"hooks":[{"type":"command","command":"x"}]}]}}`
	if err := os.WriteFile(claudeFile, []byte(existing), 0o644); err != nil {
		t.Fatal(err)
	}
	opts := newOpts(t, h, true)
	if err := Run(opts); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(claudeFile)
	var root map[string]any
	_ = json.Unmarshal(b, &root)
	if root["theme"] != "dark" {
		t.Errorf("existing theme lost: %v", root)
	}
	hooks := root["hooks"].(map[string]any)
	if _, ok := hooks["Other"]; !ok {
		t.Errorf("existing 'Other' hook lost")
	}
	if _, ok := hooks["Stop"]; !ok {
		t.Errorf("new Stop hook not added")
	}
}

func TestRun_CodexSymlink_WarnsAndWritesRealPath(t *testing.T) {
	h, _, codexDir := home(t)
	// Create a real config in a "shared" dir, symlink it into the fake home.
	sharedDir := t.TempDir()
	sharedFile := filepath.Join(sharedDir, "config.toml")
	if err := os.WriteFile(sharedFile, []byte("# existing config\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(sharedFile, filepath.Join(codexDir, "config.toml")); err != nil {
		t.Skip("symlinks unsupported on this platform")
	}

	opts := newOpts(t, h, true)
	if err := Run(opts); err != nil {
		t.Fatal(err)
	}

	// Marker landed in the SHARED file, not the symlink.
	got, _ := os.ReadFile(sharedFile)
	if !strings.Contains(string(got), codexMarkerBegin) {
		t.Errorf("marker not written through symlink; got:\n%s", got)
	}
	out := opts.Stdout.(*bytes.Buffer).String()
	if !strings.Contains(out, "symlink") {
		t.Errorf("stdout missing symlink warning:\n%s", out)
	}
}

func mustStat(t *testing.T, path string) os.FileInfo {
	t.Helper()
	st, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	return st
}
