// Package interfaces defines Studio domain ports.
package interfaces

import (
	"context"

	"github.com/Liapoldus/studio/internal/domain/models"
)

type DesktopStore interface {
	SaveConnection(context.Context, models.CoreConnection) error
	ListConnections(context.Context) ([]models.CoreConnection, error)
	DeleteConnection(context.Context, string) error
	SaveClientState(context.Context, models.ClientState) error
	ReadClientState(context.Context) (models.ClientState, error)
}
