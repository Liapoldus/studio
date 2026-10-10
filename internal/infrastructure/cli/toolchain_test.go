package cli

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"strings"
	"testing"

	"github.com/Liapoldus/studio/internal/domain/models"
)

func TestToolchainProbeReadsOnlyVersionMetadata(t *testing.T) {
	t.Setenv("STUDIO_TOOLCHAIN_HELPER", "version")
	probe := ToolchainProbe{
		LookPath: func(string) (string, error) { return "/opt/liapoldus", nil },
		Command: func(_ context.Context, path string, args ...string) *exec.Cmd {
			if path != "/opt/liapoldus" || len(args) != 1 || args[0] != "version" {
				t.Fatalf("unexpected probe command: %s %v", path, args)
			}
			return exec.Command(os.Args[0], "-test.run=TestToolchainHelperProcess", "--") //nolint:gosec // fixed test helper process.
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
		Command: func(context.Context, string, ...string) *exec.Cmd {
			return exec.Command(os.Args[0], "-test.run=TestToolchainHelperProcess", "--") //nolint:gosec // fixed test helper process.
		},
	}
	t.Setenv("STUDIO_TOOLCHAIN_HELPER", "invalid")
	status = probe.Status(context.Background())
	if status.ErrorCode != "cli.protocol" || status.CLIVersion != "" {
		t.Fatalf("unexpected invalid protocol status: %+v", status)
	}
}

func TestToolchainHelperProcess(t *testing.T) {
	if os.Getenv("STUDIO_TOOLCHAIN_HELPER") == "" {
		return
	}
	if strings.EqualFold(os.Getenv("STUDIO_TOOLCHAIN_HELPER"), "version") {
		_, _ = os.Stdout.WriteString(`{"version":"1.2.3"}`)
		return
	}
	_, _ = os.Stdout.WriteString(`token=secret`)
}
