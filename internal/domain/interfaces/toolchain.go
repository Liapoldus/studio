package interfaces

import (
	"context"

	"github.com/Liapoldus/studio/internal/domain/models"
)

// ToolchainProbe reads only the local CLI executable metadata. It never opens
// a Core connection and never returns process environment or credentials.
type ToolchainProbe interface {
	Status(context.Context) models.ToolchainStatus
}
