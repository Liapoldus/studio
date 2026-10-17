//go:build windows

package filesystem

import (
	"errors"
	"os"

	"golang.org/x/sys/windows"
)

func tryAcquireFileLock(file *os.File) (func() error, error) {
	overlapped := &windows.Overlapped{}
	err := windows.LockFileEx(windows.Handle(file.Fd()), windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, overlapped)
	if err != nil {
		return nil, err
	}
	return func() error { return windows.UnlockFileEx(windows.Handle(file.Fd()), 0, 1, 0, overlapped) }, nil
}

func isFileLockBusy(err error) bool {
	return errors.Is(err, windows.ERROR_LOCK_VIOLATION)
}
