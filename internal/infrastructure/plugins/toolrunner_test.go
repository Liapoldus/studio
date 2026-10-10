package plugins

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Liapoldus/studio/internal/domain/models"
)

func TestToolRunnerUsesManifestAndRedactsOutput(t *testing.T) {
	root := t.TempDir()
	toolPath := filepath.Join(root, "bin", "compiler")
	if err := os.MkdirAll(filepath.Dir(toolPath), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(toolPath, []byte("#!/bin/sh\nprintf '%s' '{\"token\":\"secret\",\"status\":\"ok\"}'\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(toolPath, 0700); err != nil { //nolint:gosec // test fixture must be executable.
		t.Fatal(err)
	}
	result, err := (ToolRunner{Mode: SandboxBestEffort}).Run(context.Background(), models.ToolExecutionRequest{
		PluginPath:  root,
		ProjectRoot: root,
		ToolID:      "runtime.wasm-compiler",
		Digest:      "sha256:tool",
		Manifest: models.StudioPluginManifest{Tools: []models.CompanionTool{{
			ID: "runtime.wasm-compiler", Version: "1.0.0", Executable: "bin/compiler",
		}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.ToolID != "runtime.wasm-compiler" || result.Version != "1.0.0" || result.Digest != "sha256:tool" || result.Sandboxed || result.Warning != "sandbox.unavailable" || strings.Contains(result.Stdout, "secret") || !strings.Contains(result.Stdout, "[REDACTED]") {
		t.Fatalf("unexpected tool result: %+v", result)
	}
}

func TestToolRunnerRejectsUndeclaredOrEscapingTool(t *testing.T) {
	root := t.TempDir()
	request := models.ToolExecutionRequest{PluginPath: root, ProjectRoot: root, ToolID: "missing", Manifest: models.StudioPluginManifest{}}
	if _, err := (ToolRunner{}).Run(context.Background(), request); !errors.Is(err, ErrToolNotFound) {
		t.Fatalf("expected undeclared tool rejection, got %v", err)
	}
	request.ToolID = "bad"
	request.Manifest.Tools = []models.CompanionTool{{ID: "bad", Version: "1", Executable: "../outside"}}
	if _, err := (ToolRunner{}).Run(context.Background(), request); err == nil {
		t.Fatal("accepted escaping executable")
	}
}

func TestToolRunnerEnforcesManifestTimeout(t *testing.T) {
	root := t.TempDir()
	toolPath := filepath.Join(root, "sleep")
	if err := os.WriteFile(toolPath, []byte("#!/bin/sh\nsleep 1\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(toolPath, 0700); err != nil { //nolint:gosec // test fixture must be executable.
		t.Fatal(err)
	}
	result, err := (ToolRunner{}).Run(context.Background(), models.ToolExecutionRequest{
		PluginPath: root, ProjectRoot: root, ToolID: "slow",
		Manifest: models.StudioPluginManifest{Tools: []models.CompanionTool{{ID: "slow", Version: "1", Executable: "sleep", TimeoutMillis: 10}}},
	})
	if !errors.Is(err, ErrToolTimeout) || !result.TimedOut || result.ExitCode != -1 {
		t.Fatalf("expected timeout, got %+v %v", result, err)
	}
}
