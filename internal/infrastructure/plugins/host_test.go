package plugins

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/Liapoldus/studio/internal/domain/models"
	"github.com/Liapoldus/studio/internal/infrastructure/sqlite"
)

func TestHostRejectsTamperedInstalledArtifact(t *testing.T) {
	tool := "#!/bin/sh\nprintf '%s' '{\"status\":\"ok\"}'\n"
	digest := sha256.Sum256([]byte(tool))
	packagePath := writePackage(t, map[string]string{
		"manifest.json": fmt.Sprintf(`{"id":"runtime.integrity","name":"Integrity","version":"1.0.0","tools":[{"id":"runtime.compiler","version":"1.0.0","executable":"bin/compiler","artifacts":[{"platform":"%s/%s","path":"bin/compiler","digest":"sha256:%s"}]}]}`, runtime.GOOS, runtime.GOARCH, hex.EncodeToString(digest[:])),
		"bin/compiler":  tool,
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
	installed, err := host.Install(context.Background(), packagePath, approvedPackageTrust(t, host, packagePath, nil))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(installed.Path, "bin", "compiler"), []byte("tampered"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := host.RunTool(context.Background(), installed.Manifest.ID, installed.Manifest.Version, "runtime.compiler", t.TempDir(), nil); !errors.Is(err, models.ErrInvalidStudioPlugin) {
		t.Fatalf("tampered installed tool was executed: %v", err)
	}
}

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
	decision := approvedPackageTrust(t, host, packagePath, nil)
	decision.Reason = "test approval"
	installed, err := host.Install(context.Background(), packagePath, decision)
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

func TestHostDoesNotPersistTrustWhenReviewedPackageWasReplaced(t *testing.T) {
	packagePath := writePackage(t, map[string]string{"manifest.json": `{"id":"runtime.bound","name":"Bound","version":"1.0.0"}`})
	replacement := writePackage(t, map[string]string{"manifest.json": `{"id":"runtime.bound","name":"Bound","version":"1.0.0","permissions":["project.read"]}`})
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
	trust := approvedPackageTrust(t, host, packagePath, nil)
	if _, installErr := host.Install(context.Background(), replacement, trust); !errors.Is(installErr, models.ErrStudioPluginDigestMismatch) {
		t.Fatalf("replacement package was installed after review: %v", installErr)
	}
	installed, err := host.List(context.Background())
	if err != nil || len(installed) != 0 {
		t.Fatalf("mismatched package created installed/trust state: %+v %v", installed, err)
	}
}

func TestHostServesOnlyAssetsInsideDeclaredUISurface(t *testing.T) {
	//nolint:gosec // fake marker exercises that undeclared package metadata is unreachable.
	packagePath := writePackage(t, map[string]string{
		"manifest.json":   `{"id":"runtime.ui","name":"Runtime UI","version":"1.0.0","surfaces":[{"id":"console","kind":"page","title":"Console","route":"ui/index.html"}]}`,
		"ui/index.html":   "<!doctype html><script src=\"./app.js\"></script>",
		"ui/app.js":       "parent.postMessage({type:'studio.surface.ready'}, '*')",
		"manifest.secret": "must not be reachable",
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
	trust := approvedPackageTrust(t, host, packagePath, nil)
	trust.Reason = "test approval"
	installed, err := host.Install(context.Background(), packagePath, trust)
	if err != nil {
		t.Fatal(err)
	}
	data, contentType, err := host.SurfaceAsset(context.Background(), installed.Manifest.ID, installed.Manifest.Version, "console", "ui/index.html")
	if err != nil || string(data) != "<!doctype html><script src=\"./app.js\"></script>" || !strings.HasPrefix(contentType, "text/html") {
		t.Fatalf("expected declared HTML entry, got %q %q: %v", data, contentType, err)
	}
	if _, _, err := host.SurfaceAsset(context.Background(), installed.Manifest.ID, installed.Manifest.Version, "console", "ui/app.js"); err != nil {
		t.Fatalf("expected surface-relative JS asset: %v", err)
	}
	for _, invalid := range []string{"../manifest.secret", "manifest.secret", "ui/../manifest.secret", `ui\\app.js`, "/ui/index.html"} {
		if _, _, err := host.SurfaceAsset(context.Background(), installed.Manifest.ID, installed.Manifest.Version, "console", invalid); err == nil {
			t.Errorf("served asset outside the UI surface for path %q", invalid)
		}
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
	trust := approvedPackageTrust(t, host, packagePath, nil)
	trust.Reason = "test approval"
	installed, err := host.Install(context.Background(), packagePath, trust)
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
	firstTrust := approvedPackageTrust(t, host, packageV1, nil)
	firstTrust.Reason = "test approval"
	first, err := host.Install(context.Background(), packageV1, firstTrust)
	if err != nil {
		t.Fatal(err)
	}
	secondTrust := approvedPackageTrust(t, host, packageV2, nil)
	secondTrust.Reason = "test approval"
	second, err := host.Install(context.Background(), packageV2, secondTrust)
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
