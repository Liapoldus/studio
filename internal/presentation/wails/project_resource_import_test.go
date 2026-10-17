package wails

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	projectfs "github.com/Liapoldus/studio/internal/infrastructure/filesystem"
)

func TestImportProjectResourceArtifactCopiesWithoutOverwriting(t *testing.T) {
	root := t.TempDir()
	sourceDir := t.TempDir()
	source := filepath.Join(sourceDir, "docs bundle.tar.gz")
	contents := []byte("archive payload")
	if err := os.WriteFile(source, contents, 0600); err != nil {
		t.Fatal(err)
	}
	files := projectfs.FileSystem{}

	relative, err := importProjectResourceArtifact(context.Background(), files, root, source)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(relative, "resources/docs-bundle-") || !strings.HasSuffix(relative, ".tar.gz") {
		t.Fatalf("unexpected imported path %q", relative)
	}
	got, err := files.ReadFile(context.Background(), root, relative)
	if err != nil || string(got) != string(contents) {
		t.Fatalf("imported contents = %q, error = %v", got, err)
	}
	// #nosec G304 -- source is created under t.TempDir in this test.
	if sourceContents, readErr := os.ReadFile(source); readErr != nil || string(sourceContents) != string(contents) {
		t.Fatalf("original source changed: %q, error = %v", sourceContents, readErr)
	}
	second, err := importProjectResourceArtifact(context.Background(), files, root, source)
	if err != nil || second != relative {
		t.Fatalf("idempotent import = %q, %v; want %q", second, err, relative)
	}
}

func TestImportProjectCertificateCopiesOnlyPublicCertificate(t *testing.T) {
	root := t.TempDir()
	sourceDir := t.TempDir()
	certificate := testProjectCertificate(t)
	source := filepath.Join(sourceDir, "public.pem")
	if err := os.WriteFile(source, certificate, 0600); err != nil {
		t.Fatal(err)
	}
	files := projectfs.FileSystem{}

	relative, err := importProjectCertificate(context.Background(), files, root, source)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(relative, "resources/certificate-") || !strings.HasSuffix(relative, ".crt") {
		t.Fatalf("unexpected imported path %q", relative)
	}
	stored, err := files.ReadFile(context.Background(), root, relative)
	if err != nil || !bytes.Equal(stored, certificate) {
		t.Fatalf("stored certificate differs: err=%v", err)
	}
	again, err := importProjectCertificate(context.Background(), files, root, source)
	if err != nil || again != relative {
		t.Fatalf("repeat import = %q, %v; want %q", again, err, relative)
	}
	// #nosec G304 -- source is created under t.TempDir in this test.
	original, err := os.ReadFile(source)
	if err != nil || !bytes.Equal(original, certificate) {
		t.Fatalf("original certificate changed: %v", err)
	}
}

func TestImportProjectCertificateRejectsPrivateKeysAndUnsafeFiles(t *testing.T) {
	root := t.TempDir()
	sourceDir := t.TempDir()
	files := projectfs.FileSystem{}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	privateDER, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	privatePEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: privateDER})
	for name, contents := range map[string][]byte{
		"private.pem":  privatePEM,
		"mixed.pem":    append(testProjectCertificate(t), privatePEM...),
		"not-cert.pem": []byte("not a certificate"),
		"wrong.txt":    testProjectCertificate(t),
	} {
		path := filepath.Join(sourceDir, name)
		if err := os.WriteFile(path, contents, 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := importProjectCertificate(context.Background(), files, root, path); err == nil {
			t.Errorf("unsafe input %q was accepted", name)
		}
	}
	real := filepath.Join(sourceDir, "real.crt")
	if err := os.WriteFile(real, testProjectCertificate(t), 0600); err != nil {
		t.Fatal(err)
	}
	symlink := filepath.Join(sourceDir, "link.crt")
	if err := os.Symlink(real, symlink); err == nil {
		if _, importErr := importProjectCertificate(context.Background(), files, root, symlink); importErr == nil {
			t.Fatal("symlink certificate was accepted")
		}
	} else if !errors.Is(err, os.ErrPermission) && !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("create symlink: %v", err)
	}
}

func testProjectCertificate(t *testing.T) []byte {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "test.example"},
		NotBefore:    now.Add(-time.Minute), NotAfter: now.Add(time.Hour),
		KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
		IsCA:     true, BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
}

func TestImportProjectResourceArtifactRejectsUnsafeInputs(t *testing.T) {
	root := t.TempDir()
	sourceDir := t.TempDir()
	files := projectfs.FileSystem{}

	for _, name := range []string{"private.key.tgz", "payload.txt"} {
		path := filepath.Join(sourceDir, name)
		if err := os.WriteFile(path, []byte("data"), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := importProjectResourceArtifact(context.Background(), files, root, path); err == nil {
			t.Fatalf("unsafe artifact %q was accepted", name)
		}
	}

	outside := filepath.Join(sourceDir, "real.tgz")
	if err := os.WriteFile(outside, []byte("data"), 0600); err != nil {
		t.Fatal(err)
	}
	symlink := filepath.Join(sourceDir, "link.tgz")
	if err := os.Symlink(outside, symlink); err == nil {
		if _, importErr := importProjectResourceArtifact(context.Background(), files, root, symlink); importErr == nil {
			t.Fatal("symlink artifact was accepted")
		}
	} else if !errors.Is(err, os.ErrPermission) && !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("create symlink: %v", err)
	}

	tooLarge := filepath.Join(sourceDir, "large.tgz")
	// #nosec G304 -- tooLarge is created under t.TempDir in this test.
	file, err := os.Create(tooLarge)
	if err != nil {
		t.Fatal(err)
	}
	if err := file.Truncate(maxImportedServiceArtifactBytes + 1); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := importProjectResourceArtifact(context.Background(), files, root, tooLarge); err == nil {
		t.Fatal("oversized artifact was accepted")
	}
}
