package wails

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/Liapoldus/studio/internal/domain/interfaces"
	"github.com/Liapoldus/studio/internal/domain/models"
	projectfs "github.com/Liapoldus/studio/internal/infrastructure/filesystem"
)

const (
	projectResourceCatalogLimit = 50
	projectCertificateMaxBytes  = 2 << 20
	projectCertificateScanLimit = 512
)

var errInvalidProjectResource = errors.New("project resource catalog is invalid or unavailable")

type serviceArtifactInputDescriptor struct {
	MediaTypes       []string `json:"mediaTypes"`
	MaxBytes         int64    `json:"maxBytes"`
	MaxMetadataBytes int64    `json:"maxMetadataBytes"`
}

type serviceActionDescriptor struct {
	ArtifactInput *serviceArtifactInputDescriptor `json:"artifactInput"`
	ID            string                          `json:"id"`
	Confirmation  string                          `json:"confirmation"`
}

func serviceArtifactAction(raw []byte, serviceID, pageID, actionID, mediaType string) (string, int64, int64, bool, error) {
	if len(raw) == 0 || len(raw) > 1<<20 {
		return "", 0, 0, false, errInvalidProjectResource
	}
	var response struct {
		ServiceID  string `json:"serviceId"`
		Descriptor struct {
			Pages []struct {
				ID       string `json:"id"`
				Sections []struct {
					Actions []serviceActionDescriptor `json:"actions"`
				} `json:"sections"`
			} `json:"pages"`
		} `json:"descriptor"`
	}
	if err := json.Unmarshal(raw, &response); err != nil || response.ServiceID != serviceID || len(response.Descriptor.Pages) == 0 || len(response.Descriptor.Pages) > 128 {
		return "", 0, 0, false, errInvalidProjectResource
	}
	var match *serviceActionDescriptor
	for _, page := range response.Descriptor.Pages {
		if page.ID != pageID {
			continue
		}
		for _, section := range page.Sections {
			for index := range section.Actions {
				action := &section.Actions[index]
				if action.ID != actionID {
					continue
				}
				if match != nil || action.ArtifactInput == nil || action.ArtifactInput.MaxBytes <= 0 || action.ArtifactInput.MaxBytes > 1<<30 || action.ArtifactInput.MaxMetadataBytes <= 0 || action.ArtifactInput.MaxMetadataBytes > 1<<20 {
					return "", 0, 0, false, errInvalidProjectResource
				}
				match = action
			}
		}
	}
	if match == nil || strings.TrimSpace(match.Confirmation) == "" || len(match.Confirmation) > 512 {
		return "", 0, 0, false, errInvalidProjectResource
	}
	allowed := false
	for _, declared := range match.ArtifactInput.MediaTypes {
		parsed, _, err := mime.ParseMediaType(declared)
		if err == nil && parsed == mediaType {
			allowed = true
		}
	}
	return match.Confirmation, match.ArtifactInput.MaxBytes, match.ArtifactInput.MaxMetadataBytes, allowed, nil
}

func stageServiceActionMetadata(projectRoot string, contents []byte) (string, func() error, error) {
	if !safeServiceActionMetadata(contents) {
		return "", nil, errInvalidProjectResource
	}
	root, err := filepath.Abs(filepath.Clean(projectRoot))
	if err != nil {
		return "", nil, err
	}
	directory := filepath.Join(root, ".studio")
	info, err := os.Lstat(directory)
	if errors.Is(err, os.ErrNotExist) {
		if mkdirErr := os.Mkdir(directory, 0700); mkdirErr != nil {
			return "", nil, mkdirErr
		}
		info, err = os.Lstat(directory)
	}
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", nil, errInvalidProjectResource
	}
	file, err := os.CreateTemp(directory, "resource-action-*.json")
	if err != nil {
		return "", nil, err
	}
	name := file.Name()
	cleanup := func() error {
		removeErr := os.Remove(name)
		if errors.Is(removeErr, os.ErrNotExist) {
			return nil
		}
		return removeErr
	}
	if chmodErr := file.Chmod(0600); chmodErr != nil {
		closeErr := file.Close()
		return "", nil, errors.Join(chmodErr, closeErr, cleanup())
	}
	if _, writeErr := file.Write(contents); writeErr != nil {
		closeErr := file.Close()
		return "", nil, errors.Join(writeErr, closeErr, cleanup())
	}
	if closeErr := file.Close(); closeErr != nil {
		return "", nil, errors.Join(closeErr, cleanup())
	}
	relative, err := filepath.Rel(root, name)
	if err != nil || filepath.IsAbs(relative) || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", nil, errors.Join(errInvalidProjectResource, cleanup())
	}
	return filepath.ToSlash(relative), cleanup, nil
}

type projectResourceDescriptor struct {
	ID            string `json:"id"`
	Kind          string `json:"kind"`
	Provider      string `json:"provider"`
	PageID        string `json:"pageId"`
	QueryResource string `json:"queryResource"`
	ValuePointer  string `json:"valuePointer"`
	LabelPointer  string `json:"labelPointer"`
}

type projectResourceOption struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

// stageServiceArtifactSnapshot copies the selected Project file into a private
// Studio-owned file before showing the native confirmation. The CLI therefore
// uploads exactly the bytes whose size and digest the operator reviewed, even
// if an editor changes the canonical file while the dialog is open.
func stageServiceArtifactSnapshot(projectRoot, relative string, maxBytes int64) (string, int64, string, func() error, error) {
	if maxBytes <= 0 || maxBytes > 1<<30 || !safeProjectResourcePath(relative) {
		return "", 0, "", nil, errInvalidProjectResource
	}
	sourcePath, err := projectfs.ResolvePath(projectRoot, filepath.FromSlash(relative))
	if err != nil {
		return "", 0, "", nil, err
	}
	sourceInfo, err := os.Lstat(sourcePath)
	if err != nil || !sourceInfo.Mode().IsRegular() || sourceInfo.Size() < 0 || sourceInfo.Size() > maxBytes {
		return "", 0, "", nil, errInvalidProjectResource
	}
	source, err := os.Open(sourcePath) //nolint:gosec // sourcePath is confined and symlink-checked by ResolvePath.
	if err != nil {
		return "", 0, "", nil, err
	}
	defer func() { discardProjectResourceError(source.Close()) }()
	openedInfo, err := source.Stat()
	if err != nil || !openedInfo.Mode().IsRegular() || !os.SameFile(sourceInfo, openedInfo) {
		return "", 0, "", nil, errInvalidProjectResource
	}
	root, err := filepath.Abs(filepath.Clean(projectRoot))
	if err != nil {
		return "", 0, "", nil, err
	}
	studioDir := filepath.Join(root, ".studio")
	if mkdirErr := os.Mkdir(studioDir, 0700); mkdirErr != nil && !errors.Is(mkdirErr, os.ErrExist) {
		return "", 0, "", nil, mkdirErr
	}
	directoryInfo, err := os.Lstat(studioDir)
	if err != nil || !directoryInfo.IsDir() || directoryInfo.Mode()&os.ModeSymlink != 0 {
		return "", 0, "", nil, errInvalidProjectResource
	}
	staged, err := os.CreateTemp(studioDir, "resource-publish-*.bin")
	if err != nil {
		return "", 0, "", nil, err
	}
	stagedPath := staged.Name()
	cleanup := func() error {
		removeErr := os.Remove(stagedPath)
		if errors.Is(removeErr, os.ErrNotExist) {
			return nil
		}
		return removeErr
	}
	if chmodErr := staged.Chmod(0600); chmodErr != nil {
		return "", 0, "", nil, errors.Join(chmodErr, staged.Close(), cleanup())
	}
	hasher := sha256.New()
	copied, copyErr := io.Copy(io.MultiWriter(staged, hasher), io.LimitReader(source, maxBytes+1))
	if copyErr != nil {
		return "", 0, "", nil, errors.Join(copyErr, staged.Close(), cleanup())
	}
	if copied > maxBytes || copied != openedInfo.Size() {
		return "", 0, "", nil, errors.Join(errInvalidProjectResource, staged.Close(), cleanup())
	}
	if syncErr := staged.Sync(); syncErr != nil {
		return "", 0, "", nil, errors.Join(syncErr, staged.Close(), cleanup())
	}
	if chmodErr := staged.Chmod(0400); chmodErr != nil {
		return "", 0, "", nil, errors.Join(chmodErr, staged.Close(), cleanup())
	}
	if closeErr := staged.Close(); closeErr != nil {
		return "", 0, "", nil, errors.Join(closeErr, cleanup())
	}
	relativeStaged, err := filepath.Rel(root, stagedPath)
	if err != nil || filepath.IsAbs(relativeStaged) || relativeStaged == ".." || strings.HasPrefix(relativeStaged, ".."+string(filepath.Separator)) {
		return "", 0, "", nil, errors.Join(errInvalidProjectResource, cleanup())
	}
	return filepath.ToSlash(relativeStaged), copied, fmt.Sprintf("sha256:%x", hasher.Sum(nil)), cleanup, nil
}

func discardProjectResourceError(err error) { _ = err }

// projectResourceCatalog returns only project-relative references. Manifest
// metadata is obtained through the typed CLI → Core path before consulting the
// host-owned project file index.
func projectResourceCatalog(ctx context.Context, descriptor projectResourceDescriptor, workspace models.Workspace, files interfaces.FileSystem) (string, error) {
	if workspace.Project == nil {
		return "", models.ErrInvalidProject
	}
	if descriptor.Provider != "project" {
		return "", errInvalidProjectResource
	}
	items, err := projectResourceOptions(ctx, workspace, descriptor.Kind, files)
	if err != nil {
		return "", err
	}
	encoded, err := json.Marshal(struct {
		Items []projectResourceOption `json:"items"`
	}{Items: items})
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

func findProjectResourceDescriptor(manifest []byte, resourceID string) (projectResourceDescriptor, error) {
	if len(manifest) == 0 || len(manifest) > 262_144 || !safeProjectResourceID(resourceID) {
		return projectResourceDescriptor{}, errInvalidProjectResource
	}
	var document struct {
		Resources []projectResourceDescriptor `json:"resources"`
	}
	decoder := json.NewDecoder(bytes.NewReader(manifest))
	if err := decoder.Decode(&document); err != nil || len(document.Resources) > 256 {
		return projectResourceDescriptor{}, errInvalidProjectResource
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return projectResourceDescriptor{}, errInvalidProjectResource
	}
	seen := make(map[string]struct{}, len(document.Resources))
	var selected *projectResourceDescriptor
	for _, resource := range document.Resources {
		if !safeProjectResourceID(resource.ID) {
			return projectResourceDescriptor{}, errInvalidProjectResource
		}
		if _, duplicate := seen[resource.ID]; duplicate {
			return projectResourceDescriptor{}, errInvalidProjectResource
		}
		seen[resource.ID] = struct{}{}
		if resource.ID != resourceID {
			continue
		}
		if selected != nil || !validProjectResourceKind(resource.Kind) || (resource.Provider != "project" && resource.Provider != "service-admin") {
			return projectResourceDescriptor{}, errInvalidProjectResource
		}
		if resource.Provider == "project" && (resource.PageID != "" || resource.QueryResource != "" || resource.ValuePointer != "" || resource.LabelPointer != "") {
			return projectResourceDescriptor{}, errInvalidProjectResource
		}
		selectedResource := resource
		selected = &selectedResource
	}
	if selected == nil {
		return projectResourceDescriptor{}, errInvalidProjectResource
	}
	return *selected, nil
}

func projectResourceOptions(ctx context.Context, workspace models.Workspace, kind string, files interfaces.FileSystem) ([]projectResourceOption, error) {
	if kind != "file" && kind != "certificate" {
		return nil, fmt.Errorf("%w: project resource kind %q is not supported", errInvalidProjectResource, kind)
	}
	paths := make([]string, 0, len(workspace.Files))
	sizes := make(map[string]int64, len(workspace.Files))
	for _, item := range workspace.Files {
		if item.Kind != "directory" && safeProjectResourcePath(item.Path) {
			paths = append(paths, item.Path)
			sizes[item.Path] = item.Bytes
		}
	}
	sort.Strings(paths)
	items := make([]projectResourceOption, 0, projectResourceCatalogLimit)
	candidates := 0
	for _, relative := range paths {
		if kind == "certificate" {
			if !certificateExtension(relative) {
				continue
			}
			candidates++
			if candidates > projectCertificateScanLimit {
				break
			}
			if files == nil {
				continue
			}
			if sizes[relative] < 0 || sizes[relative] > projectCertificateMaxBytes {
				continue
			}
			data, err := files.ReadFile(ctx, workspace.Project.RootPath, relative)
			if err == nil && containsPublicCertificate(data) {
				items = append(items, projectResourceOption{Value: relative, Label: relative})
			}
		} else {
			if sensitiveResourceExtension(relative) {
				continue
			}
			items = append(items, projectResourceOption{Value: relative, Label: relative})
		}
		if len(items) == projectResourceCatalogLimit {
			break
		}
	}
	return items, nil
}

func sensitiveResourceExtension(value string) bool {
	switch strings.ToLower(path.Ext(value)) {
	case ".pem", ".key", ".p8", ".p12", ".pfx", ".p7b", ".p7c", ".p7m", ".p7s", ".p10", ".csr", ".crt", ".cer", ".der", ".jks", ".keystore", ".kdb", ".asc", ".gpg", ".pgp", ".enc":
		return true
	default:
		return false
	}
}

const maxImportedServiceArtifactBytes = 128 << 20

const (
	maxProjectDirectoryFiles = 10000
	maxProjectDirectoryBytes = 128 << 20
)

// packageProjectDirectory produces a deterministic tar.gz from a directory
// already inside the canonical Project. Symlinks and non-regular entries are
// rejected so an artifact cannot include files outside the selected tree.
func packageProjectDirectory(selected string) (archivePath string, returnErr error) {
	rootInfo, err := os.Lstat(selected)
	if err != nil || !rootInfo.IsDir() || rootInfo.Mode()&os.ModeSymlink != 0 {
		return "", fmt.Errorf("%w: choose a regular Project directory", errInvalidProjectResource)
	}
	output, err := os.CreateTemp("", "liapoldus-project-assets-*.tar.gz")
	if err != nil {
		return "", fmt.Errorf("%w: could not create a temporary archive", errInvalidProjectResource)
	}
	outputPath := output.Name()
	succeeded := false
	defer func() {
		if !succeeded {
			if cleanupErr := os.Remove(outputPath); cleanupErr != nil && !errors.Is(cleanupErr, os.ErrNotExist) {
				returnErr = errors.Join(returnErr, cleanupErr)
			}
		}
	}()
	gzipWriter := gzip.NewWriter(output)
	gzipWriter.Name = ""
	gzipWriter.ModTime = time.Time{}
	tarWriter := tar.NewWriter(gzipWriter)
	files := 0
	var totalBytes int64
	err = filepath.WalkDir(selected, func(fullPath string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if fullPath == selected {
			return nil
		}
		info, infoErr := os.Lstat(fullPath)
		if infoErr != nil || info.Mode()&os.ModeSymlink != 0 {
			return errInvalidProjectResource
		}
		if info.IsDir() {
			return nil
		}
		if !info.Mode().IsRegular() || sensitiveResourceExtension(fullPath) || sensitiveArchiveName(filepath.Base(fullPath)) {
			return errInvalidProjectResource
		}
		relative, relErr := filepath.Rel(selected, fullPath)
		if relErr != nil || !filepath.IsLocal(relative) || strings.Contains(filepath.ToSlash(relative), "../") {
			return errInvalidProjectResource
		}
		files++
		totalBytes += info.Size()
		if files > maxProjectDirectoryFiles || info.Size() < 0 || totalBytes > maxProjectDirectoryBytes {
			return errInvalidProjectResource
		}
		header := &tar.Header{Name: filepath.ToSlash(relative), Mode: 0o644, Size: info.Size(), Typeflag: tar.TypeReg, ModTime: time.Time{}, AccessTime: time.Time{}, ChangeTime: time.Time{}, Format: tar.FormatPAX}
		if headerErr := tarWriter.WriteHeader(header); headerErr != nil {
			return headerErr
		}
		// The descriptor is statted and compared with the non-following Lstat
		// result before any bytes are read, so an intervening symlink swap fails closed.
		file, openErr := os.Open(fullPath) //nolint:gosec // Guarded by Lstat, regular-file checks, and SameFile before CopyN.
		if openErr != nil {
			return openErr
		}
		openedInfo, statErr := file.Stat()
		if statErr != nil || !openedInfo.Mode().IsRegular() || !os.SameFile(info, openedInfo) {
			closeErr := file.Close()
			return errors.Join(errInvalidProjectResource, statErr, closeErr)
		}
		_, copyErr := io.CopyN(tarWriter, file, info.Size())
		closeErr := file.Close()
		if copyErr != nil {
			return copyErr
		}
		return closeErr
	})
	if err == nil && files == 0 {
		err = errInvalidProjectResource
	}
	if closeErr := tarWriter.Close(); err == nil {
		err = closeErr
	}
	if closeErr := gzipWriter.Close(); err == nil {
		err = closeErr
	}
	if closeErr := output.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return "", fmt.Errorf("%w: could not package Project directory", errInvalidProjectResource)
	}
	succeeded = true
	return outputPath, nil
}

// importProjectResourceArtifact copies a user-selected archive into the
// canonical Project tree using a content-addressed filename. The source is
// never modified, existing files are never overwritten, and only bounded
// regular files with supported archive suffixes are accepted.
func importProjectResourceArtifact(ctx context.Context, files interfaces.FileSystem, root, selected string) (string, error) {
	if files == nil || selected == "" || sensitiveResourceExtension(selected) || sensitiveArchiveName(selected) {
		return "", errInvalidProjectResource
	}
	base := filepath.Base(selected)
	name, extension := "", ""
	switch {
	case strings.HasSuffix(strings.ToLower(base), ".tar.gz"):
		name, extension = base[:len(base)-len(".tar.gz")], ".tar.gz"
	case strings.HasSuffix(strings.ToLower(base), ".tgz"):
		name, extension = base[:len(base)-len(".tgz")], ".tgz"
	default:
		return "", errInvalidProjectResource
	}
	info, err := os.Lstat(selected)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Size() < 0 || info.Size() > maxImportedServiceArtifactBytes {
		return "", fmt.Errorf("%w: artifact must be a regular file no larger than 128 MiB", errInvalidProjectResource)
	}
	// #nosec G304 -- the native file picker supplies this external path; Lstat
	// rejects symlinks and Stat/SameFile below detects replacement races.
	file, err := os.Open(selected)
	if err != nil {
		return "", fmt.Errorf("%w: could not read selected artifact", errInvalidProjectResource)
	}
	openedInfo, statErr := file.Stat()
	if statErr != nil || !openedInfo.Mode().IsRegular() || !os.SameFile(info, openedInfo) {
		if closeErr := file.Close(); closeErr != nil {
			return "", fmt.Errorf("%w: could not close changed artifact", errInvalidProjectResource)
		}
		return "", fmt.Errorf("%w: selected artifact changed while opening", errInvalidProjectResource)
	}
	data, readErr := io.ReadAll(io.LimitReader(file, maxImportedServiceArtifactBytes+1))
	closeErr := file.Close()
	if readErr != nil || closeErr != nil || int64(len(data)) > maxImportedServiceArtifactBytes {
		return "", fmt.Errorf("%w: could not read bounded artifact", errInvalidProjectResource)
	}
	digest := sha256.Sum256(data)
	safeRunes := make([]rune, 0, min(len(name), 64))
	for _, char := range name {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || char == '-' || char == '_' {
			safeRunes = append(safeRunes, char)
		} else if len(safeRunes) == 0 || safeRunes[len(safeRunes)-1] != '-' {
			safeRunes = append(safeRunes, '-')
		}
		if len(safeRunes) >= 64 {
			break
		}
	}
	stem := strings.Trim(string(safeRunes), "-")
	if stem == "" {
		stem = "artifact"
	}
	relative := filepath.ToSlash(filepath.Join("resources", stem+"-"+hex.EncodeToString(digest[:12])+extension))
	if err := files.CreateFile(ctx, root, relative, data); err != nil {
		if !errors.Is(err, os.ErrExist) {
			return "", fmt.Errorf("%w: could not import artifact into Project", errInvalidProjectResource)
		}
		stored, readErr := files.ReadFile(ctx, root, relative)
		if readErr != nil || sha256.Sum256(stored) != digest {
			return "", fmt.Errorf("%w: content-addressed Project artifact already exists with different content", errInvalidProjectResource)
		}
	}
	return relative, nil
}

// importProjectCertificate accepts only a bounded regular file containing one
// or more public X.509 certificates. Private keys, mixed PEM bundles and
// arbitrary files are rejected before any Project mutation.
func importProjectCertificate(ctx context.Context, files interfaces.FileSystem, root, selected string) (string, error) {
	if files == nil || selected == "" || !certificateExtension(selected) {
		return "", errInvalidProjectResource
	}
	info, err := os.Lstat(selected)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Size() <= 0 || info.Size() > projectCertificateMaxBytes {
		return "", errInvalidProjectResource
	}
	// #nosec G304 -- the native file picker supplies this external path; Lstat
	// and SameFile reject symlinks and replacement races.
	file, err := os.Open(selected)
	if err != nil {
		return "", errInvalidProjectResource
	}
	opened, statErr := file.Stat()
	if statErr != nil || !opened.Mode().IsRegular() || !os.SameFile(info, opened) {
		if closeErr := file.Close(); closeErr != nil {
			return "", errInvalidProjectResource
		}
		return "", errInvalidProjectResource
	}
	data, readErr := io.ReadAll(io.LimitReader(file, projectCertificateMaxBytes+1))
	closeErr := file.Close()
	if readErr != nil || closeErr != nil || len(data) == 0 || len(data) > projectCertificateMaxBytes || int64(len(data)) != opened.Size() || !containsPublicCertificate(data) {
		return "", errInvalidProjectResource
	}
	digest := sha256.Sum256(data)
	relative := filepath.ToSlash(filepath.Join("resources", "certificate-"+hex.EncodeToString(digest[:16])+".crt"))
	if err := files.CreateFile(ctx, root, relative, data); err != nil {
		if !errors.Is(err, os.ErrExist) {
			return "", errInvalidProjectResource
		}
		stored, readErr := files.ReadFile(ctx, root, relative)
		if readErr != nil || sha256.Sum256(stored) != digest {
			return "", errInvalidProjectResource
		}
	}
	return relative, nil
}

func sensitiveArchiveName(value string) bool {
	base := strings.ToLower(filepath.Base(value))
	for _, suffix := range []string{".pem.tar.gz", ".key.tar.gz", ".p12.tar.gz", ".pfx.tar.gz", ".pem.tgz", ".key.tgz", ".p12.tgz", ".pfx.tgz"} {
		if strings.HasSuffix(base, suffix) {
			return true
		}
	}
	return false
}

func containsPublicCertificate(data []byte) bool {
	if len(data) == 0 || len(data) > projectCertificateMaxBytes {
		return false
	}
	remaining := bytes.TrimSpace(data)
	if block, _ := pem.Decode(remaining); block == nil {
		_, err := x509.ParseCertificate(data)
		return err == nil
	}
	foundCertificate := false
	for len(remaining) > 0 {
		remaining = bytes.TrimLeft(remaining, " \t\r\n")
		if len(remaining) == 0 {
			break
		}
		if !bytes.HasPrefix(remaining, []byte("-----BEGIN ")) {
			return false
		}
		block, rest := pem.Decode(remaining)
		if block == nil || block.Type != "CERTIFICATE" {
			return false
		}
		if _, err := x509.ParseCertificate(block.Bytes); err != nil {
			return false
		}
		foundCertificate = true
		remaining = rest
	}
	return foundCertificate
}

func safeProjectResourcePath(value string) bool {
	if len(value) > 512 || !fs.ValidPath(value) || strings.Contains(value, `\`) || strings.HasPrefix(value, "/") || strings.ContainsAny(value, "\x00\r\n") {
		return false
	}
	for _, character := range value {
		if unicode.IsControl(character) {
			return false
		}
	}
	for _, segment := range strings.Split(value, "/") {
		lower := strings.ToLower(segment)
		if segment == "." || segment == ".." || strings.HasPrefix(segment, ".") {
			return false
		}
		name := strings.Map(func(character rune) rune {
			if character >= 'a' && character <= 'z' || character >= '0' && character <= '9' {
				return character
			}
			return -1
		}, lower)
		for _, marker := range []string{"secret", "token", "password", "passwd", "privatekey", "credential", "authorization", "authkey"} {
			if strings.Contains(name, marker) {
				return false
			}
		}
	}
	return true
}

func safeServiceActionMetadata(data []byte) bool {
	if len(data) == 0 || len(data) > 1<<20 {
		return false
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var value any
	if decoder.Decode(&value) != nil {
		return false
	}
	var trailing any
	if !errors.Is(decoder.Decode(&trailing), io.EOF) {
		return false
	}
	if _, ok := value.(map[string]any); !ok {
		return false
	}
	return safeServiceActionMetadataValue(value, 0)
}

func safeServiceActionMetadataValue(value any, depth int) bool {
	if depth > 32 {
		return false
	}
	switch typed := value.(type) {
	case map[string]any:
		if len(typed) > 512 {
			return false
		}
		for key, child := range typed {
			lower := strings.ToLower(key)
			for _, marker := range []string{"secret", "password", "token", "privatekey", "private_key", "credential", "authorization"} {
				if strings.Contains(lower, marker) {
					return false
				}
			}
			if key == "__proto__" || key == "constructor" || key == "prototype" || !safeServiceActionMetadataValue(child, depth+1) {
				return false
			}
		}
	case []any:
		if len(typed) > 4096 {
			return false
		}
		for _, child := range typed {
			if !safeServiceActionMetadataValue(child, depth+1) {
				return false
			}
		}
	case string:
		if len(typed) > 16_384 || strings.ContainsAny(typed, "\x00\r\n") {
			return false
		}
	}
	return true
}

func safeProjectResourceID(value string) bool {
	if value == "" || len(value) > 128 || strings.HasPrefix(value, "-") {
		return false
	}
	for _, character := range value {
		switch {
		case character >= 'a' && character <= 'z':
		case character >= 'A' && character <= 'Z':
		case character >= '0' && character <= '9':
		case character == '.', character == '_', character == '-':
		default:
			return false
		}
	}
	return true
}

func validProjectResourceKind(value string) bool {
	switch value {
	case "file", "certificate", "site", "artifact":
		return true
	default:
		return false
	}
}

func certificateExtension(value string) bool {
	switch strings.ToLower(path.Ext(value)) {
	case ".pem", ".crt", ".cer", ".der":
		return true
	default:
		return false
	}
}
