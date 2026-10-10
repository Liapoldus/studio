// Package plugins validates and installs local .studio-plugin packages.
package plugins

import (
	"archive/zip"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/Liapoldus/studio/internal/domain/interfaces"
	"github.com/Liapoldus/studio/internal/domain/models"
)

var (
	ErrTrustRequired           = errors.New("explicit plugin trust approval is required")
	ErrPluginAlreadyInstalled  = errors.New("this Studio plugin version is already installed")
	ErrPluginSignatureInvalid  = errors.New("studio plugin signature is invalid")
	ErrPluginSignatureRequired = errors.New("a signed Studio plugin is required in this release mode")
	ErrPluginTrustRootMissing  = errors.New("studio plugin signing trust root is unavailable")
	pluginIDPattern            = regexp.MustCompile(`^[a-z0-9]+(?:[._-][a-z0-9]+)+$`)
	pluginVersionPattern       = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9.+_-]*$`)
)

//nolint:govet // the public installer keeps a readable path, trust roots and policy flag together.
type Installer struct {
	Directory         string
	TrustedKeys       map[string]ed25519.PublicKey
	RequireSignatures bool
}

var _ interfaces.PluginPackageInstaller = Installer{}

func (i Installer) Inspect(ctx context.Context, packagePath string) (models.PluginInspection, error) {
	archive, err := zip.OpenReader(packagePath)
	if err != nil {
		return models.PluginInspection{}, models.ErrInvalidStudioPlugin
	}
	defer func() {
		discardError(archive.Close())
	}()
	digest, err := fileDigest(packagePath)
	if err != nil {
		return models.PluginInspection{}, err
	}
	manifest, files, err := readManifest(archive.File)
	if err != nil {
		return models.PluginInspection{}, err
	}
	if err := validateManifest(manifest, files); err != nil {
		return models.PluginInspection{}, err
	}
	if err := verifyArtifactDigests(archive.File, manifest); err != nil {
		return models.PluginInspection{}, err
	}
	if err := i.verifyManifestSignature(manifest); err != nil {
		return models.PluginInspection{}, err
	}
	return models.PluginInspection{Manifest: manifest, Digest: digest, Signed: strings.TrimSpace(manifest.Signature) != "", Files: files}, nil
}

func (i Installer) verifyManifestSignature(manifest models.StudioPluginManifest) error {
	signature := strings.TrimSpace(manifest.Signature)
	if signature == "" {
		if i.RequireSignatures {
			return ErrPluginSignatureRequired
		}
		return nil
	}
	parts := strings.Split(signature, ":")
	if len(parts) != 3 || parts[0] != "ed25519" || strings.TrimSpace(parts[1]) == "" {
		return ErrPluginSignatureInvalid
	}
	key, trusted := i.TrustedKeys[parts[1]]
	if !trusted {
		if len(i.TrustedKeys) == 0 && !i.RequireSignatures {
			return nil
		}
		return ErrPluginTrustRootMissing
	}
	encoded := strings.TrimSpace(parts[2])
	signatureBytes, err := base64.RawStdEncoding.DecodeString(encoded)
	if err != nil {
		signatureBytes, err = base64.StdEncoding.DecodeString(encoded)
	}
	if err != nil || len(signatureBytes) != ed25519.SignatureSize {
		return ErrPluginSignatureInvalid
	}
	payload, err := canonicalManifestPayload(manifest)
	if err != nil || !ed25519.Verify(key, payload, signatureBytes) {
		return ErrPluginSignatureInvalid
	}
	return nil
}

func canonicalManifestPayload(manifest models.StudioPluginManifest) ([]byte, error) {
	manifest.Signature = ""
	return json.Marshal(manifest)
}

// ParseTrustRoots parses key-id=base64(raw Ed25519 public key) pairs. Empty
// values intentionally produce an empty local-mode trust store.
func ParseTrustRoots(value string) (map[string]ed25519.PublicKey, error) {
	keys := make(map[string]ed25519.PublicKey)
	for _, item := range strings.Split(strings.TrimSpace(value), ",") {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		parts := strings.SplitN(item, "=", 2)
		if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" {
			return nil, ErrPluginTrustRootMissing
		}
		encoded := strings.TrimSpace(parts[1])
		keyBytes, err := base64.RawStdEncoding.DecodeString(encoded)
		if err != nil {
			keyBytes, err = base64.StdEncoding.DecodeString(encoded)
		}
		if err != nil || len(keyBytes) != ed25519.PublicKeySize {
			return nil, ErrPluginTrustRootMissing
		}
		keys[parts[0]] = ed25519.PublicKey(keyBytes)
	}
	return keys, nil
}

func (i Installer) Install(ctx context.Context, packagePath string, trust models.TrustDecision) (models.InstalledPlugin, error) {
	if !trust.Approved {
		return models.InstalledPlugin{}, ErrTrustRequired
	}
	inspection, err := i.Inspect(ctx, packagePath)
	if err != nil {
		return models.InstalledPlugin{}, err
	}
	if contextErr := ctx.Err(); contextErr != nil {
		return models.InstalledPlugin{}, contextErr
	}
	if !permissionsApproved(inspection.Manifest.Permissions, trust.GrantedPermissions) {
		return models.InstalledPlugin{}, models.ErrPermissionApprovalRequired
	}
	if !filepath.IsAbs(i.Directory) || strings.ContainsRune(i.Directory, '\x00') {
		return models.InstalledPlugin{}, models.ErrInvalidStudioPlugin
	}
	base := filepath.Join(filepath.Clean(i.Directory), inspection.Manifest.ID, inspection.Manifest.Version)
	if mkdirErr := os.MkdirAll(filepath.Dir(base), 0700); mkdirErr != nil {
		return models.InstalledPlugin{}, mkdirErr
	}
	if info, statErr := os.Stat(base); statErr == nil && info.IsDir() {
		return models.InstalledPlugin{}, ErrPluginAlreadyInstalled
	}
	temporary, err := os.MkdirTemp(filepath.Dir(base), ".install-*")
	if err != nil {
		return models.InstalledPlugin{}, err
	}
	defer func() {
		discardError(os.RemoveAll(temporary))
	}()
	archive, err := zip.OpenReader(packagePath)
	if err != nil {
		return models.InstalledPlugin{}, models.ErrInvalidStudioPlugin
	}
	defer func() {
		discardError(archive.Close())
	}()
	for _, entry := range archive.File {
		if contextErr := ctx.Err(); contextErr != nil {
			return models.InstalledPlugin{}, contextErr
		}
		destination, err := safeArchivePath(temporary, entry.Name)
		if err != nil {
			return models.InstalledPlugin{}, err
		}
		if entry.FileInfo().IsDir() {
			if mkdirErr := os.MkdirAll(destination, 0700); mkdirErr != nil {
				return models.InstalledPlugin{}, mkdirErr
			}
			continue
		}
		if mkdirErr := os.MkdirAll(filepath.Dir(destination), 0700); mkdirErr != nil {
			return models.InstalledPlugin{}, mkdirErr
		}
		reader, err := entry.Open()
		if err != nil {
			return models.InstalledPlugin{}, err
		}
		// The destination is inside a fresh temp directory and the archive entry
		// has passed safeArchivePath; executable tools need owner-only execute bits.
		file, createErr := os.OpenFile(destination, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0700) //nolint:gosec // validated package path and intentional executable mode
		if createErr == nil {
			_, createErr = io.Copy(file, io.LimitReader(reader, 64*1024*1024))
		}
		if closeErr := reader.Close(); createErr == nil {
			createErr = closeErr
		}
		if file != nil {
			if closeErr := file.Close(); createErr == nil {
				createErr = closeErr
			}
		}
		if createErr != nil {
			return models.InstalledPlugin{}, createErr
		}
	}
	if err := os.Rename(temporary, base); err != nil {
		return models.InstalledPlugin{}, fmt.Errorf("activate Studio plugin: %w", err)
	}
	return models.InstalledPlugin{Manifest: inspection.Manifest, Digest: inspection.Digest, Path: base}, nil
}

func fileDigest(path string) (string, error) {
	source := os.DirFS(filepath.Dir(path))
	file, err := source.Open(filepath.Base(path))
	if err != nil {
		return "", err
	}
	defer func() {
		discardError(file.Close())
	}()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return "sha256:" + hex.EncodeToString(hash.Sum(nil)), nil
}

func readManifest(entries []*zip.File) (models.StudioPluginManifest, []string, error) {
	files := make([]string, 0, len(entries))
	var manifest models.StudioPluginManifest
	manifestFound := false
	for _, entry := range entries {
		if _, err := safeArchivePath("/validated", entry.Name); err != nil {
			return models.StudioPluginManifest{}, nil, err
		}
		if !entry.FileInfo().IsDir() {
			files = append(files, filepath.ToSlash(entry.Name))
		}
		if entry.Name != "manifest.json" {
			continue
		}
		reader, err := entry.Open()
		if err != nil {
			return models.StudioPluginManifest{}, nil, err
		}
		decodeErr := json.NewDecoder(io.LimitReader(reader, 2*1024*1024)).Decode(&manifest)
		closeErr := reader.Close()
		if decodeErr != nil || closeErr != nil {
			return models.StudioPluginManifest{}, nil, models.ErrInvalidStudioPlugin
		}
		manifestFound = true
	}
	if !manifestFound {
		return models.StudioPluginManifest{}, nil, models.ErrInvalidStudioPlugin
	}
	sort.Strings(files)
	return manifest, files, nil
}

func validateManifest(manifest models.StudioPluginManifest, files []string) error {
	if !pluginIDPattern.MatchString(manifest.ID) || !pluginVersionPattern.MatchString(manifest.Version) || strings.TrimSpace(manifest.Name) == "" || strings.TrimSpace(manifest.Version) == "" {
		return models.ErrInvalidStudioPlugin
	}
	fileSet := make(map[string]bool, len(files))
	for _, file := range files {
		fileSet[file] = true
	}
	permissionSet := make(map[string]bool, len(manifest.Permissions))
	for _, permission := range manifest.Permissions {
		permission = strings.TrimSpace(permission)
		if permission == "" || permissionSet[permission] {
			return models.ErrInvalidStudioPlugin
		}
		permissionSet[permission] = true
	}
	for _, tool := range manifest.Tools {
		if !pluginIDPattern.MatchString(tool.ID) || strings.TrimSpace(tool.Version) == "" || !fileSet[filepath.ToSlash(tool.Executable)] {
			return models.ErrInvalidStudioPlugin
		}
		if err := validateArtifacts(tool.Artifacts, fileSet); err != nil {
			return err
		}
		for _, name := range tool.Environment {
			if !validEnvironmentName(name) {
				return models.ErrInvalidStudioPlugin
			}
		}
	}
	if manifest.Process != nil {
		if !fileSet[filepath.ToSlash(manifest.Process.Executable)] || !platformDescriptorValid(manifest.Process.Platforms) {
			return models.ErrInvalidStudioPlugin
		}
		if err := validateArtifacts(manifest.Process.Artifacts, fileSet); err != nil {
			return err
		}
		for _, name := range manifest.Process.Environment {
			if !validEnvironmentName(name) {
				return models.ErrInvalidStudioPlugin
			}
		}
	}
	for _, surface := range manifest.Surfaces {
		if strings.TrimSpace(surface.ID) == "" || !map[string]bool{"page": true, "panel": true, "inspector": true, "form": true, "command": true}[surface.Kind] {
			return models.ErrInvalidStudioPlugin
		}
		if surface.Schema != "" {
			if _, err := safeArchivePath("/validated", surface.Schema); err != nil || !fileSet[filepath.ToSlash(surface.Schema)] {
				return models.ErrInvalidStudioPlugin
			}
		}
	}
	return nil
}

func validateArtifacts(artifacts []models.PluginArtifact, fileSet map[string]bool) error {
	for _, artifact := range artifacts {
		if strings.TrimSpace(artifact.Platform) == "" || !platformDescriptorValid([]string{artifact.Platform}) || strings.TrimSpace(artifact.Digest) == "" {
			return models.ErrInvalidStudioPlugin
		}
		path := filepath.ToSlash(artifact.Path)
		if _, err := safeArchivePath("/validated", path); err != nil || !fileSet[path] {
			return models.ErrInvalidStudioPlugin
		}
		if !validSHA256(artifact.Digest) {
			return models.ErrInvalidStudioPlugin
		}
	}
	return nil
}

func validSHA256(value string) bool {
	if !strings.HasPrefix(value, "sha256:") || len(value) != len("sha256:")+sha256.Size*2 {
		return false
	}
	_, err := hex.DecodeString(strings.TrimPrefix(value, "sha256:"))
	return err == nil
}

func verifyArtifactDigests(entries []*zip.File, manifest models.StudioPluginManifest) error {
	byPath := make(map[string]*zip.File, len(entries))
	for _, entry := range entries {
		byPath[filepath.ToSlash(entry.Name)] = entry
	}
	artifacts := make([]models.PluginArtifact, 0)
	for _, tool := range manifest.Tools {
		artifacts = append(artifacts, tool.Artifacts...)
	}
	if manifest.Process != nil {
		artifacts = append(artifacts, manifest.Process.Artifacts...)
	}
	for _, artifact := range artifacts {
		entry := byPath[filepath.ToSlash(artifact.Path)]
		if entry == nil {
			return models.ErrInvalidStudioPlugin
		}
		reader, err := entry.Open()
		if err != nil {
			return models.ErrInvalidStudioPlugin
		}
		hash := sha256.New()
		count, copyErr := io.Copy(hash, io.LimitReader(reader, 64*1024*1024+1))
		closeErr := reader.Close()
		if copyErr != nil || closeErr != nil || count > 64*1024*1024 || "sha256:"+hex.EncodeToString(hash.Sum(nil)) != strings.ToLower(artifact.Digest) {
			return models.ErrInvalidStudioPlugin
		}
	}
	return nil
}

func platformDescriptorValid(platforms []string) bool {
	for _, platform := range platforms {
		if strings.TrimSpace(platform) == "" || strings.ContainsAny(platform, "\x00 \t\r\n") {
			return false
		}
	}
	return true
}

func validEnvironmentName(name string) bool {
	if name == "" {
		return false
	}
	for index, character := range name {
		if (character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') || character == '_' || (index > 0 && character >= '0' && character <= '9') {
			continue
		}
		return false
	}
	return true
}

func permissionsApproved(requested, granted []string) bool {
	requestedSet := make(map[string]struct{}, len(requested))
	for _, permission := range requested {
		permission = strings.TrimSpace(permission)
		if permission == "" {
			return false
		}
		requestedSet[permission] = struct{}{}
	}
	grants := make(map[string]struct{}, len(granted))
	for _, permission := range granted {
		permission = strings.TrimSpace(permission)
		if permission == "" {
			return false
		}
		if _, ok := requestedSet[permission]; !ok {
			return false
		}
		if _, duplicate := grants[permission]; duplicate {
			return false
		}
		grants[permission] = struct{}{}
	}
	for permission := range requestedSet {
		if _, ok := grants[permission]; !ok {
			return false
		}
	}
	return true
}

func safeArchivePath(root, name string) (string, error) {
	if strings.ContainsRune(name, '\x00') || filepath.IsAbs(name) {
		return "", models.ErrInvalidStudioPlugin
	}
	clean := filepath.Clean(filepath.FromSlash(name))
	if clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", models.ErrInvalidStudioPlugin
	}
	return filepath.Join(root, clean), nil
}

func discardError(err error) { _ = err }
