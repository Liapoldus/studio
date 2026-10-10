package plugins

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Liapoldus/studio/internal/domain/models"
	"github.com/Liapoldus/studio/internal/infrastructure/sqlite"
)

func TestHostPersistsTrustAndRunsInstalledTool(t *testing.T) {
	packagePath := writePackage(t, map[string]string{
		"manifest.json":          `{"id":"runtime.tools","name":"Runtime Tools","version":"1.0.0","surfaces":[{"id":"compiler","kind":"panel","title":"Compiler","schema":"surfaces/compiler.json"}],"tools":[{"id":"runtime.wasm-compiler","version":"1.0.0","executable":"bin/compiler"}]}`,
		"surfaces/compiler.json": `{"type":"object","properties":{"optimization":{"type":"boolean","default":true}}}`,
		"bin/compiler":           "#!/bin/sh\nprintf '%s' '{\"status\":\"ok\"}'\n",
	})
	store, err := sqlite.Open(filepath.Join(t.TempDir(), "client.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if closeErr := store.Close(); closeErr != nil {
			t.Error(closeErr)
		}
	}()
	host := NewHost(store, ToolRunner{}, Installer{Directory: filepath.Join(t.TempDir(), "plugins")})
	installed, err := host.Install(context.Background(), packagePath, models.TrustDecision{Approved: true, Reason: "test approval"})
	if err != nil {
		t.Fatal(err)
	}
	if _, statErr := os.Stat(filepath.Join(installed.Path, "manifest.json")); statErr != nil {
		t.Fatal(statErr)
	}
	surface, err := host.Surface(context.Background(), installed.Manifest.ID, installed.Manifest.Version, "compiler")
	if err != nil || !strings.Contains(surface, "optimization") {
		t.Fatalf("surface: %s %v", surface, err)
	}
	result, err := host.RunTool(context.Background(), installed.Manifest.ID, installed.Manifest.Version, "runtime.wasm-compiler", t.TempDir(), nil)
	if err != nil || result.ExitCode != 0 || result.Stdout == "" {
		t.Fatalf("tool result: %+v %v", result, err)
	}
	trust, err := store.ReadTrustState(context.Background(), installed.Digest)
	if err != nil || !trust.Approved || trust.Reason != "test approval" {
		t.Fatalf("trust state: %+v %v", trust, err)
	}
}

func TestHostSupervisesDeclaredProcessFailure(t *testing.T) {
	packagePath := writePackage(t, map[string]string{
		"manifest.json": `{"id":"runtime.process","name":"Runtime Process","version":"1.0.0","process":{"executable":"bin/backend","platforms":["*"]}}`,
		"bin/backend":   "#!/bin/sh\nexit 42\n",
	})
	store, err := sqlite.Open(filepath.Join(t.TempDir(), "client.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if closeErr := store.Close(); closeErr != nil {
			t.Error(closeErr)
		}
	}()
	host := NewHost(store, ToolRunner{}, Installer{Directory: filepath.Join(t.TempDir(), "plugins")})
	installed, err := host.Install(context.Background(), packagePath, models.TrustDecision{Approved: true, Reason: "test approval"})
	if err != nil {
		t.Fatal(err)
	}
	projectRoot := t.TempDir()
	status, err := host.StartProcess(context.Background(), installed.Manifest.ID, installed.Manifest.Version, projectRoot)
	if err != nil || status.State != "running" {
		t.Fatalf("process did not start: %+v %v", status, err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		status, err = host.ProcessStatus(context.Background(), installed.Manifest.ID, installed.Manifest.Version)
		if err != nil {
			t.Fatal(err)
		}
		if status.State == "failed" {
			if status.ErrorCode != "process.exit" {
				t.Fatalf("unexpected process failure: %+v", status)
			}
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("process failure was not observed: %+v", status)
}

func TestHostRemovesOnlyRequestedVersionForRollback(t *testing.T) {
	packageV1 := writePackage(t, map[string]string{
		"manifest.json": `{"id":"runtime.rollback","name":"Rollback","version":"1.0.0"}`,
	})
	packageV2 := writePackage(t, map[string]string{
		"manifest.json": `{"id":"runtime.rollback","name":"Rollback","version":"2.0.0"}`,
	})
	store, err := sqlite.Open(filepath.Join(t.TempDir(), "client.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if closeErr := store.Close(); closeErr != nil {
			t.Error(closeErr)
		}
	}()
	host := NewHost(store, ToolRunner{}, Installer{Directory: filepath.Join(t.TempDir(), "plugins")})
	first, err := host.Install(context.Background(), packageV1, models.TrustDecision{Approved: true, Reason: "test approval"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := host.Install(context.Background(), packageV2, models.TrustDecision{Approved: true, Reason: "test approval"})
	if err != nil {
		t.Fatal(err)
	}
	if removeErr := host.Remove(context.Background(), second.Manifest.ID, second.Manifest.Version); removeErr != nil {
		t.Fatal(removeErr)
	}
	if _, statErr := os.Stat(first.Path); statErr != nil {
		t.Fatalf("rollback version was removed: %v", statErr)
	}
	installed, err := host.List(context.Background())
	if err != nil || len(installed) != 1 || installed[0].Version != "1.0.0" {
		t.Fatalf("installed versions after rollback: %+v %v", installed, err)
	}
}
