// Package interfaces defines Studio domain ports.
package interfaces

import (
	"context"

	"github.com/Liapoldus/studio/internal/domain/models"
)

type DesktopStore interface {
	SaveProject(context.Context, models.Project) error
	ListProjects(context.Context) ([]models.Project, error)
	DeleteProject(context.Context, string) error
	SaveClientState(context.Context, models.ClientState) error
	ReadClientState(context.Context) (models.ClientState, error)
}
