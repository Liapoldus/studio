package plugins

import (
	"archive/zip"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Liapoldus/studio/internal/domain/models"
)

func TestInstallerRequiresTrustAndInstallsAtomically(t *testing.T) {
	packagePath := writePackage(t, map[string]string{
		"manifest.json": `{"id":"runtime.tools","name":"Runtime Tools","version":"1.0.0","surfaces":[{"id":"compiler","kind":"panel","title":"Compiler"}],"tools":[{"id":"runtime.wasm-compiler","version":"1.0.0","executable":"bin/compiler"}]}`,
		"bin/compiler":  "binary",
	})
	installer := Installer{Directory: t.TempDir()}
	inspection, err := installer.Inspect(context.Background(), packagePath)
	if err != nil || inspection.Manifest.ID != "runtime.tools" || inspection.Digest == "" {
		t.Fatalf("inspection=%+v err=%v", inspection, err)
	}
	if _, installErr := installer.Install(context.Background(), packagePath, models.TrustDecision{}); !errors.Is(installErr, ErrTrustRequired) {
		t.Fatalf("expected trust requirement, got %v", installErr)
	}
	installed, err := installer.Install(context.Background(), packagePath, models.TrustDecision{Approved: true, Reason: "local package approval"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(installed.Path, "manifest.json")); err != nil {
		t.Fatal(err)
	}
	if _, duplicateErr := installer.Install(context.Background(), packagePath, models.TrustDecision{Approved: true}); !errors.Is(duplicateErr, ErrPluginAlreadyInstalled) {
		t.Fatalf("duplicate version was not rejected safely: %v", duplicateErr)
	}
}

func TestInstallerRejectsTraversal(t *testing.T) {
	packagePath := writePackage(t, map[string]string{
		"manifest.json": `{"id":"runtime.tools","name":"Runtime Tools","version":"1.0.0"}`,
		"../escape":     "no",
	})
	if _, err := (Installer{Directory: t.TempDir()}).Inspect(context.Background(), packagePath); !errors.Is(err, models.ErrInvalidStudioPlugin) {
		t.Fatalf("expected traversal rejection, got %v", err)
	}
}

func TestInstallerRejectsUnsafeVersionPath(t *testing.T) {
	packagePath := writePackage(t, map[string]string{
		"manifest.json": `{"id":"runtime.tools","name":"Runtime Tools","version":"../escape"}`,
	})
	if _, err := (Installer{Directory: t.TempDir()}).Inspect(context.Background(), packagePath); !errors.Is(err, models.ErrInvalidStudioPlugin) {
		t.Fatalf("accepted unsafe version path: %v", err)
	}
}

func TestInstallerRejectsUntrustedEnvironmentName(t *testing.T) {
	packagePath := writePackage(t, map[string]string{
		"manifest.json": `{"id":"runtime.tools","name":"Runtime Tools","version":"1.0.0","tools":[{"id":"runtime.compiler","version":"1.0.0","executable":"bin/compiler","environment":["TOKEN=secret"]}]}`,
		"bin/compiler":  "binary",
	})
	if _, err := (Installer{Directory: t.TempDir()}).Inspect(context.Background(), packagePath); !errors.Is(err, models.ErrInvalidStudioPlugin) {
		t.Fatalf("accepted environment assignment instead of variable name: %v", err)
	}
}

func TestInstallerRequiresAllDeclaredPermissions(t *testing.T) {
	packagePath := writePackage(t, map[string]string{
		"manifest.json": `{"id":"runtime.permissions","name":"Runtime Permissions","version":"1.0.0","permissions":["project.read","reports.read"]}`,
	})
	installer := Installer{Directory: t.TempDir()}
	if _, err := installer.Install(context.Background(), packagePath, models.TrustDecision{Approved: true, GrantedPermissions: []string{"project.read"}}); !errors.Is(err, models.ErrPermissionApprovalRequired) {
		t.Fatalf("expected missing permission approval, got %v", err)
	}
	if _, err := installer.Install(context.Background(), packagePath, models.TrustDecision{Approved: true, GrantedPermissions: []string{"project.read", "reports.read"}}); err != nil {
		t.Fatalf("approved permissions rejected: %v", err)
	}
}

func TestInstallerVerifiesDeclaredArtifactDigest(t *testing.T) {
	digest := sha256.Sum256([]byte("binary"))
	manifest := fmt.Sprintf(`{"id":"runtime.artifacts","name":"Runtime Artifacts","version":"1.0.0","tools":[{"id":"runtime.compiler","version":"1.0.0","executable":"bin/compiler","artifacts":[{"platform":"%s/%s","path":"bin/compiler","digest":"sha256:%s"}]}]}`, "darwin", "arm64", hex.EncodeToString(digest[:]))
	packagePath := writePackage(t, map[string]string{"manifest.json": manifest, "bin/compiler": "binary"})
	if _, err := (Installer{Directory: t.TempDir()}).Inspect(context.Background(), packagePath); err != nil {
		t.Fatalf("valid artifact digest rejected: %v", err)
	}
	badManifest := fmt.Sprintf(`{"id":"runtime.artifacts","name":"Runtime Artifacts","version":"1.0.0","tools":[{"id":"runtime.compiler","version":"1.0.0","executable":"bin/compiler","artifacts":[{"platform":"darwin/arm64","path":"bin/compiler","digest":"sha256:%s"}]}]}`, strings.Repeat("0", sha256.Size*2))
	badPackage := writePackage(t, map[string]string{"manifest.json": badManifest, "bin/compiler": "binary"})
	if _, err := (Installer{Directory: t.TempDir()}).Inspect(context.Background(), badPackage); !errors.Is(err, models.ErrInvalidStudioPlugin) {
		t.Fatalf("invalid artifact digest accepted: %v", err)
	}
}

func TestInstallerVerifiesManifestSignatureWhenTrustRootIsConfigured(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	manifest := models.StudioPluginManifest{ID: "runtime.signed", Name: "Signed Runtime", Version: "1.0.0"}
	payload, err := canonicalManifestPayload(manifest)
	if err != nil {
		t.Fatal(err)
	}
	manifest.Signature = "ed25519:publisher:" + base64.RawStdEncoding.EncodeToString(ed25519.Sign(privateKey, payload))
	manifestData, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	packagePath := writePackage(t, map[string]string{"manifest.json": string(manifestData)})
	installer := Installer{Directory: t.TempDir(), TrustedKeys: map[string]ed25519.PublicKey{"publisher": publicKey}}
	inspection, err := installer.Inspect(context.Background(), packagePath)
	if err != nil || !inspection.Signed {
		t.Fatalf("valid signature rejected: %+v %v", inspection, err)
	}
	manifest.Name = "Tampered Runtime"
	tamperedData, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	tamperedPackage := writePackage(t, map[string]string{"manifest.json": string(tamperedData)})
	if _, err := installer.Inspect(context.Background(), tamperedPackage); !errors.Is(err, ErrPluginSignatureInvalid) {
		t.Fatalf("tampered signature accepted: %v", err)
	}
}

func TestInstallerRequiresSignatureInReleaseMode(t *testing.T) {
	packagePath := writePackage(t, map[string]string{"manifest.json": `{"id":"runtime.release","name":"Release Runtime","version":"1.0.0"}`})
	installer := Installer{Directory: t.TempDir(), RequireSignatures: true}
	if _, err := installer.Inspect(context.Background(), packagePath); !errors.Is(err, ErrPluginSignatureRequired) {
		t.Fatalf("unsigned release package accepted: %v", err)
	}
}

func TestParseTrustRootsRejectsMalformedKeys(t *testing.T) {
	if keys, err := ParseTrustRoots("publisher=not-base64"); err == nil || keys != nil {
		t.Fatalf("accepted malformed trust root: %v", err)
	}
	if keys, err := ParseTrustRoots(""); err != nil || len(keys) != 0 {
		t.Fatalf("unexpected empty trust roots: %+v %v", keys, err)
	}
}

func writePackage(t *testing.T, entries map[string]string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "plugin.studio-plugin")
	file, err := os.Create(path) //nolint:gosec // test path is created inside t.TempDir
	if err != nil {
		t.Fatal(err)
	}
	archive := zip.NewWriter(file)
	for name, content := range entries {
		writer, createErr := archive.Create(name)
		if createErr != nil {
			t.Fatal(createErr)
		}
		if _, writeErr := writer.Write([]byte(content)); writeErr != nil {
			t.Fatal(writeErr)
		}
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	return path
}
