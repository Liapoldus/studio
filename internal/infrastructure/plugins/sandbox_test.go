package plugins

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"
)

func TestRequiredModeFailsClosedWithoutSandbox(t *testing.T) {
	_, _, _, err := runnerCommand(context.Background(), ToolRunner{Mode: SandboxRequired}, "/tmp/plugin/tool", nil, SandboxPolicy{
		PackageRoot: "/tmp/plugin",
		ProjectRoot: "/tmp/project",
	})
	if !errors.Is(err, ErrSandboxUnavailable) {
		t.Fatalf("required mode did not fail closed: %v", err)
	}
}

func TestBestEffortModeExposesFallbackWarning(t *testing.T) {
	command, sandboxed, warning, err := runnerCommand(context.Background(), ToolRunner{Mode: SandboxBestEffort}, "/tmp/plugin/tool", nil, SandboxPolicy{
		PackageRoot: "/tmp/plugin",
		ProjectRoot: "/tmp/project",
	})
	if err != nil || sandboxed || warning != "sandbox.unavailable" || command == nil {
		t.Fatalf("unexpected best-effort result: command=%v sandboxed=%v warning=%q err=%v", command, sandboxed, warning, err)
	}
}

func TestDarwinProfileDoesNotGrantNetworkByDefault(t *testing.T) {
	profile := darwinSandboxProfile(SandboxPolicy{PackageRoot: "/tmp/plugin", ProjectRoot: "/tmp/project"})
	if strings.Contains(profile, "allow network") || !strings.Contains(profile, "file-read") || !strings.Contains(profile, filepath.Clean("/tmp/project")) {
		t.Fatalf("unexpected sandbox profile: %s", profile)
	}
}

func TestSandboxModeEnvironment(t *testing.T) {
	t.Setenv("STUDIO_PLUGIN_SANDBOX_MODE", "disabled")
	runner, err := NewToolRunnerFromENV()
	if err != nil || runner.Mode != SandboxDisabled {
		t.Fatalf("disabled mode: %+v %v", runner, err)
	}
	t.Setenv("STUDIO_PLUGIN_SANDBOX_MODE", "invalid")
	if _, err := NewToolRunnerFromENV(); !errors.Is(err, ErrSandboxUnavailable) {
		t.Fatalf("invalid sandbox mode accepted: %v", err)
	}
}
