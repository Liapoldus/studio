package interfaces

import (
	"context"

	"github.com/Liapoldus/studio/internal/domain/models"
)

// ToolchainProbe verifies the local CLI through a fixed, read-only typed command.
// It never opens a Core connection or returns process environment or credentials.
type ToolchainProbe interface {
	Status(context.Context) models.ToolchainStatus
}

// CLIExecutableInspector validates an explicitly selected local CLI without
// exposing its output or environment to the renderer.
type CLIExecutableInspector interface {
	Inspect(context.Context, string) (models.ToolchainStatus, error)
}
