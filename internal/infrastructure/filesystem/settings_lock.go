package filesystem

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Liapoldus/studio/internal/domain/models"
)

func settingsLockPath(root, relative string) (string, error) {
	root = filepath.Clean(strings.TrimSpace(root))
	if !filepath.IsAbs(root) || strings.ContainsRune(root, '\x00') {
		return "", models.ErrInvalidProject
	}
	studioDir := filepath.Join(root, ".studio")
	lockDir := filepath.Join(studioDir, "settings-locks")
	for _, dir := range []string{studioDir, lockDir} {
		if mkdirErr := os.Mkdir(dir, 0700); mkdirErr != nil && !errors.Is(mkdirErr, os.ErrExist) { //nolint:gosec // dir is a fixed Studio subdirectory below the absolute Project root.
			return "", mkdirErr
		}
		info, err := os.Lstat(dir) //nolint:gosec // dir is a fixed Studio subdirectory below the absolute Project root.
		if err != nil {
			return "", err
		}
		if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
			return "", ErrSymlinkNotAllowed
		}
	}
	key := sha256.Sum256([]byte(filepath.ToSlash(filepath.Clean(relative))))
	path := filepath.Join(lockDir, hex.EncodeToString(key[:])+".lock")
	if info, err := os.Lstat(path); err == nil && (info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular()) { //nolint:gosec // path is derived from the checked lock directory and SHA-256 of the confined relative path.
		return "", ErrSymlinkNotAllowed
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	return path, nil
}

func acquireFileLock(ctx context.Context, file *os.File) (func() error, error) {
	for {
		release, err := tryAcquireFileLock(file)
		if err == nil {
			return release, nil
		}
		if !isFileLockBusy(err) {
			return nil, err
		}
		timer := time.NewTimer(10 * time.Millisecond)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				<-timer.C
			}
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
}
