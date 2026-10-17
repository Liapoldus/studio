package cli

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/Liapoldus/studio/internal/domain/models"
)

func TestToolchainProbeUsesReadOnlyTypedContractIntent(t *testing.T) {
	probe := ToolchainProbe{
		LookPath: func(string) (string, error) { return "/opt/liapoldus", nil },
		ReadContract: func(_ context.Context, path string) ([]byte, error) {
			if path != "/opt/liapoldus" {
				t.Fatalf("unexpected probe path: %s", path)
			}
			return contractProbeEvents(t, "run.started", "run.output", "run.completed"), nil
		},
	}
	status := probe.Status(context.Background())
	if status != (models.ToolchainStatus{CLIAvailable: true, CLIPath: "/opt/liapoldus"}) {
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
		ReadContract: func(context.Context, string) ([]byte, error) {
			return []byte("credential=secret"), nil
		},
	}
	status = probe.Status(context.Background())
	if status.ErrorCode != "cli.probe" || status.CLIVersion != "" {
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
	probe := ToolchainProbe{ReadContract: func(context.Context, string) ([]byte, error) {
		return contractProbeEvents(t, "run.started", "run.completed"), nil
	}}
	status := probe.Status(context.Background())
	if !status.CLIAvailable || status.CLIPath != path || status.CLIVersion != "" {
		t.Fatalf("unexpected explicit CLI path status: %+v", status)
	}
}

func TestToolchainInspectValidatesSelectedExecutableWithoutReturningRawOutput(t *testing.T) {
	path := filepath.Join(t.TempDir(), "liapoldus")
	if err := os.WriteFile(path, []byte("binary"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0700); err != nil { //nolint:gosec // executable permission is required for the resolver fixture.
		t.Fatal(err)
	}
	probe := ToolchainProbe{ReadContract: func(context.Context, string) ([]byte, error) {
		return contractProbeEvents(t, "run.started", "run.completed"), nil
	}}
	status, err := probe.Inspect(context.Background(), path)
	if err != nil || status != (models.ToolchainStatus{CLIAvailable: true, CLIPath: path}) {
		t.Fatalf("inspect selected CLI: %+v, %v", status, err)
	}
	if _, err := probe.Inspect(context.Background(), filepath.Join(t.TempDir(), "missing")); err == nil {
		t.Fatal("accepted missing CLI executable")
	}
}

func TestValidateContractProbeRequiresCompletedTypedJSONLEvents(t *testing.T) {
	if err := validateContractProbe(contractProbeEvents(t, "run.started", "run.output", "run.completed")); err != nil {
		t.Fatalf("valid contract response rejected: %v", err)
	}
	for _, invalid := range [][]byte{
		[]byte(`{"version":"1.2.3"}`),
		contractProbeEvents(t, "run.started"),
		contractProbeEvents(t, "run.failed"),
		append(contractProbeEvents(t, "run.started"), []byte("not-json\n")...),
	} {
		if err := validateContractProbe(invalid); err == nil {
			t.Fatalf("accepted invalid contract response: %s", invalid)
		}
	}
}

func contractProbeEvents(t *testing.T, types ...string) []byte {
	t.Helper()
	var output []byte
	for _, eventType := range types {
		line, err := json.Marshal(models.CLIEvent{SchemaVersion: "cli-events/v1", Type: eventType})
		if err != nil {
			t.Fatalf("marshal event: %v", err)
		}
		output = append(output, line...)
		output = append(output, '\n')
	}
	return output
}
