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
	SaveInstalledPlugin(context.Context, models.InstalledPluginState) error
	ListInstalledPlugins(context.Context) ([]models.InstalledPluginState, error)
	DeleteInstalledPlugin(context.Context, string, string) error
	SaveTrustState(context.Context, models.TrustState) error
	ReadTrustState(context.Context, string) (models.TrustState, error)
	SaveEditorAssociation(context.Context, models.EditorAssociation) error
	ListEditorAssociations(context.Context) ([]models.EditorAssociation, error)
}
