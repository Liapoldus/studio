package cli

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/Liapoldus/studio/internal/domain/models"
)

func TestToolchainProbeReadsOnlyVersionMetadata(t *testing.T) {
	probe := ToolchainProbe{
		LookPath: func(string) (string, error) { return "/opt/liapoldus", nil },
		ReadVersion: func(_ context.Context, path string) ([]byte, error) {
			if path != "/opt/liapoldus" {
				t.Fatalf("unexpected probe path: %s", path)
			}
			return []byte(`{"version":"1.2.3"}`), nil
		},
	}
	status := probe.Status(context.Background())
	if status != (models.ToolchainStatus{CLIAvailable: true, CLIPath: "/opt/liapoldus", CLIVersion: "1.2.3"}) {
		t.Fatalf("unexpected status: %+v", status)
	}
}

func TestToolchainProbeFailsClosedWithoutLeakingCommandOutput(t *testing.T) {
	probe := ToolchainProbe{LookPath: func(string) (string, error) { return "", errors.New("not found") }}
	status := probe.Status(context.Background())
	if status.CLIAvailable || status.CLIPath != "" || status.CLIVersion != "" || status.ErrorCode != "cli.unavailable" {
		t.Fatalf("unexpected unavailable status: %+v", status)
	}

	probe = ToolchainProbe{
		LookPath: func(string) (string, error) { return "/opt/liapoldus", nil },
		ReadVersion: func(context.Context, string) ([]byte, error) {
			return []byte(`token=secret`), nil
		},
	}
	status = probe.Status(context.Background())
	if status.ErrorCode != "cli.protocol" || status.CLIVersion != "" {
		t.Fatalf("unexpected invalid protocol status: %+v", status)
	}
}

func TestToolchainProbeUsesExplicitGUIPathWhenShellPathIsUnavailable(t *testing.T) {
	path := filepath.Join(t.TempDir(), "liapoldus")
	if err := os.WriteFile(path, []byte("binary"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0700); err != nil { //nolint:gosec // executable permission is required for the resolver fixture.
		t.Fatal(err)
	}
	t.Setenv("STUDIO_CLI_PATH", path)
	probe := ToolchainProbe{
		ReadVersion: func(context.Context, string) ([]byte, error) {
			return []byte(`{"version":"dev"}`), nil
		},
	}
	status := probe.Status(context.Background())
	if !status.CLIAvailable || status.CLIPath != path || status.CLIVersion != "dev" {
		t.Fatalf("unexpected explicit CLI path status: %+v", status)
	}
}
