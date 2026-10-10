// Package desktop implements native operating-system integrations.
package desktop

import (
	"context"
	"errors"
	"os"
	"os/exec"
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
	var command *exec.Cmd
	switch {
	case application != "":
		if strings.ContainsAny(application, " \t") {
			// A selected application may legitimately contain spaces in its
			// filesystem path. Bare values containing spaces are rejected so a
			// persisted association can never be interpreted as argv text.
			if _, statErr := os.Stat(application); statErr != nil {
				return ErrInvalidEditor
			}
		}
		if runtime.GOOS == "darwin" && strings.HasSuffix(strings.ToLower(application), ".app") {
			command = &exec.Cmd{Path: "open", Args: []string{"open", "-a", application, path}}
		} else {
			// exec.Cmd receives argv directly. Spaces in an application path are
			// therefore safe and must not be treated as shell syntax.
			command = &exec.Cmd{Path: application, Args: []string{application, path}}
		}
	case runtime.GOOS == "darwin":
		command = &exec.Cmd{Path: "open", Args: []string{"open", path}}
	case runtime.GOOS == "windows":
		command = &exec.Cmd{Path: "rundll32.exe", Args: []string{"rundll32.exe", "url.dll,FileProtocolHandler", path}}
	default:
		command = &exec.Cmd{Path: "xdg-open", Args: []string{"xdg-open", path}}
	}
	return command.Start()
}
