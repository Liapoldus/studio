package interfaces

import (
	"context"

	"github.com/Liapoldus/studio/internal/domain/models"
)

type ProjectSource interface {
	Open(context.Context, string) (models.Workspace, error)
}

// ProjectStateStore keeps layout and navigation state beside the canonical
// Project while remaining outside the CLI bundle.
type ProjectStateStore interface {
	Read(context.Context, string, string) (models.WorkspaceState, error)
	Save(context.Context, string, models.WorkspaceState) error
}

// GitRepository exposes only the read model needed by the workspace shell.
// Mutating Git operations will be added behind the same boundary.
type GitRepository interface {
	Status(context.Context, string) (models.GitStatus, error)
	Diff(context.Context, string, string) (models.GitDiff, error)
	Branches(context.Context, string) ([]models.GitBranch, error)
	History(context.Context, string, int) ([]models.GitCommit, error)
	Remotes(context.Context, string) ([]models.GitRemote, error)
	Checkout(context.Context, string, string, bool) error
	Commit(context.Context, string, string, []string, bool) (string, error)
	Pull(context.Context, string, string, string, bool) error
	Push(context.Context, string, string, string, bool) error
}

type FileSystem interface {
	ReadFile(context.Context, string, string) ([]byte, error)
	WriteFile(context.Context, string, string, []byte) error
}

// SettingsStore exposes schema-aware project settings without returning
// sensitive values to the renderer. Updates are patches merged by the host so
// redacted fields remain owned by the CLI or external editor.
type SettingsStore interface {
	ReadSchema(context.Context, string, string) ([]byte, error)
	Read(context.Context, string, string, string) ([]byte, error)
	Update(context.Context, string, string, string, []byte) error
}

type ExternalEditorLauncher interface {
	Open(context.Context, string, string, string) error
}

type CLIRunner interface {
	Run(context.Context, models.CLIRequest) (<-chan models.CLIEvent, error)
}
