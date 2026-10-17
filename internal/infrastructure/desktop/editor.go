// Package desktop implements native operating-system integrations.
package desktop

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/Liapoldus/studio/internal/domain/interfaces"
	"github.com/Liapoldus/studio/internal/infrastructure/filesystem"
)

var ErrInvalidEditor = errors.New("invalid external editor")

type EditorLauncher struct{}

var _ interfaces.ExternalEditorLauncher = EditorLauncher{}

func (EditorLauncher) Open(ctx context.Context, root, relative, application string) error {
	path, err := filesystem.ResolvePath(root, relative)
	if err != nil {
		return err
	}
	application = strings.TrimSpace(application)
	if strings.ContainsRune(application, '\x00') || strings.ContainsAny(application, "\r\n") {
		return ErrInvalidEditor
	}
	if contextErr := ctx.Err(); contextErr != nil {
		return contextErr
	}
	command, err := externalEditorCommand(runtime.GOOS, os.Getenv("SystemRoot"), application, path, exec.LookPath)
	if err != nil {
		return err
	}
	return command.Start()
}

func externalEditorCommand(goos, systemRoot, application, path string, lookPath func(string) (string, error)) (*exec.Cmd, error) {
	switch {
	case application != "":
		if strings.ContainsAny(application, " \t") {
			// A selected application may legitimately contain spaces in its
			// filesystem path. Bare values containing spaces are rejected so a
			// persisted association can never be interpreted as argv text.
			if _, statErr := os.Stat(application); statErr != nil {
				return nil, ErrInvalidEditor
			}
		}
		if goos == "darwin" && strings.HasSuffix(strings.ToLower(application), ".app") {
			return nativeCommand("/usr/bin/open", "-a", application, path), nil
		}
		// The native command receives argv directly. Spaces in an application
		// path are safe and are never treated as shell syntax.
		return nativeCommand(application, path), nil
	case goos == "darwin":
		// Wails may start the app with a reduced PATH. `open` is an OS utility,
		// so resolve it by its stable system path instead of relying on PATH.
		return nativeCommand("/usr/bin/open", path), nil
	case goos == "windows":
		if systemRoot != "" {
			executable := filepath.Join(systemRoot, "System32", "rundll32.exe")
			return nativeCommand(executable, "url.dll,FileProtocolHandler", path), nil
		}
		executable, err := lookPath("rundll32.exe")
		if err != nil {
			return nil, err
		}
		return nativeCommand(executable, "url.dll,FileProtocolHandler", path), nil
	default:
		executable, err := lookPath("xdg-open")
		if err != nil {
			return nil, err
		}
		if !filepath.IsAbs(executable) {
			executable, err = filepath.Abs(executable)
			if err != nil {
				return nil, err
			}
		}
		return nativeCommand(executable, path), nil
	}
}

func nativeCommand(executable string, args ...string) *exec.Cmd {
	commandArgs := make([]string, 1, len(args)+1)
	commandArgs[0] = executable
	commandArgs = append(commandArgs, args...)
	return &exec.Cmd{Path: executable, Args: commandArgs}
}
