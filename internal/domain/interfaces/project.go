package interfaces

import (
	"context"

	"github.com/Liapoldus/studio/internal/domain/models"
)

type ProjectSource interface {
	Open(context.Context, string) (models.Workspace, error)
	Create(context.Context, string, string, string) (models.Workspace, error)
}

// ProjectStateStore keeps layout and navigation state beside the canonical
// Project while remaining outside the CLI bundle.
type ProjectStateStore interface {
	Read(context.Context, string, string) (models.WorkspaceState, error)
	Save(context.Context, string, models.WorkspaceState) error
}

// GraphRepository mutates only canonical runtime service/link files. Layout is
// deliberately kept in ProjectStateStore and never enters this boundary.
type GraphRepository interface {
	CreateRuntimeService(context.Context, string, models.RuntimeServiceInput) error
	SetRuntimeServiceArtifact(context.Context, string, string, models.ServiceArtifactInput) error
	DeleteRuntimeService(context.Context, string, string, bool) error
	CreateServiceLink(context.Context, string, models.ServiceLinkInput) error
	UpdateServiceLink(context.Context, string, string, string, models.ServiceLinkInput) error
	DeleteServiceLink(context.Context, string, string, string, bool) error
}

type FileSystem interface {
	ReadFile(context.Context, string, string) ([]byte, error)
	WriteFile(context.Context, string, string, []byte) error
	WriteFileIfDigest(context.Context, string, string, string, []byte) (bool, error)
	CreateFile(context.Context, string, string, []byte) error
}

// SettingsStore exposes schema-aware project settings without returning
// sensitive values to the renderer. Updates are patches merged by the host so
// redacted fields remain owned by the CLI or external editor.
type SettingsStore interface {
	ReadSchema(context.Context, string, string) ([]byte, error)
	ValidateSchemaDocument(context.Context, string, string, []byte) error
	RedactSchemaDocument(context.Context, string, string, []byte) ([]byte, error)
	ValidateValuesAgainstSchemaDocument(context.Context, string, string, string, []byte, []byte) (bool, error)
	ValidateSettingsDocumentAgainstSchemaDocument(context.Context, string, string, []byte, []byte) (bool, error)
	Read(context.Context, string, string, string) ([]byte, error)
	Snapshot(context.Context, string, string, string) (models.ProjectSettingsSnapshot, error)
	ValidatePatch(context.Context, string, string, string, []byte) error
	UpdateIfDigest(context.Context, string, string, string, string, []byte) error
	UpdateProjectCandidateIfDigest(context.Context, string, string, string, string, []byte) error
}

type ExternalEditorLauncher interface {
	Open(context.Context, string, string, string) error
}

type CLIRunner interface {
	Run(context.Context, models.CLIRequest) (<-chan models.CLIEvent, error)
}
