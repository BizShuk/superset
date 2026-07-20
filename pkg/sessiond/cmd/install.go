package cmd

import (
	"github.com/spf13/cobra"

	"github.com/bizshuk/sessiond/pkg/install"
)

// newInstallCmd builds `sessiond install`. Renamed from the old `install-hooks`
// (per request) to keep the cobra two-letter style — install hooks is the
// only thing this CLI ever installs, so the noun does not need to qualify the
// verb.
func newInstallCmd() *cobra.Command {
	var apply bool
	cmd := &cobra.Command{
		Use:   "install",
		Short: "Register the sessiond hooks in Claude and Codex config files",
		Long: "Writes Stop/StopFailure/TaskCompleted hooks into ~/.claude/settings.json " +
			"and Stop/SubagentStop hooks into ~/.codex/config.toml. " +
			"Dry-runs by default; pass --apply to write. Each target is backed up first.",
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			return install.Run(install.Options{Apply: apply})
		},
	}
	cmd.Flags().BoolVar(&apply, "apply", false, "actually write the changes (default: dry-run)")
	return cmd
}