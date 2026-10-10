// Package filesystem implements the project-scoped file boundary.
package filesystem

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/Liapoldus/studio/internal/domain/interfaces"
	"github.com/Liapoldus/studio/internal/domain/models"
)

var (
	ErrPathOutsideProject = errors.New("path is outside the project")
	ErrSymlinkNotAllowed  = errors.New("project symlinks are not allowed")
)

type FileSystem struct{}

var _ interfaces.FileSystem = FileSystem{}

func (FileSystem) ReadFile(ctx context.Context, root, relative string) ([]byte, error) {
	if _, resolveErr := ResolvePath(root, relative); resolveErr != nil {
		return nil, resolveErr
	}
	if contextErr := ctx.Err(); contextErr != nil {
		return nil, contextErr
	}
	return fs.ReadFile(os.DirFS(filepath.Clean(root)), filepath.ToSlash(filepath.Clean(relative)))
}

func (FileSystem) WriteFile(ctx context.Context, root, relative string, data []byte) error {
	path, err := ResolvePath(root, relative)
	if err != nil {
		return err
	}
	if contextErr := ctx.Err(); contextErr != nil {
		return contextErr
	}
	if mkdirErr := os.MkdirAll(filepath.Dir(path), 0700); mkdirErr != nil {
		return mkdirErr
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".studio-write-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer func() { discardError(os.Remove(temporaryPath)) }()
	if err := temporary.Chmod(0600); err != nil {
		discardError(temporary.Close())
		return err
	}
	if _, err := temporary.Write(data); err != nil {
		discardError(temporary.Close())
		return err
	}
	if err := temporary.Sync(); err != nil {
		discardError(temporary.Close())
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryPath, path)
}

func discardError(err error) { _ = err }

func ResolvePath(root, relative string) (string, error) {
	root = filepath.Clean(strings.TrimSpace(root))
	if !filepath.IsAbs(root) || strings.ContainsRune(root, '\x00') {
		return "", models.ErrInvalidProject
	}
	relative = filepath.Clean(strings.TrimSpace(relative))
	if relative == "." || filepath.IsAbs(relative) || strings.ContainsRune(relative, '\x00') {
		return "", ErrPathOutsideProject
	}
	parts := strings.Split(relative, string(filepath.Separator))
	if len(parts) > 0 && parts[0] == ".studio" {
		return "", ErrPathOutsideProject
	}
	joined := filepath.Join(root, relative)
	rel, err := filepath.Rel(root, joined)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", ErrPathOutsideProject
	}
	if err := rejectSymlinks(root, rel); err != nil {
		return "", err
	}
	return joined, nil
}

func rejectSymlinks(root, relative string) error {
	current := root
	for _, part := range strings.Split(relative, string(filepath.Separator)) {
		current = filepath.Join(current, part)
		info, err := os.Lstat(current)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return ErrSymlinkNotAllowed
		}
	}
	return nil
}
