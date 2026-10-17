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
	SaveServiceSettingsDraft(context.Context, string, models.ServiceSettingsDraft) error
	ReadServiceSettingsDraft(context.Context, string, string) (models.ServiceSettingsDraft, bool, error)
	DeleteServiceSettingsDraft(context.Context, string, string) error
	SaveClientState(context.Context, models.ClientState) error
	ReadClientState(context.Context) (models.ClientState, error)
	SaveCLIPath(context.Context, string) error
	SaveInstalledStudioPlugin(context.Context, models.InstalledStudioPluginState) error
	ListInstalledStudioPlugins(context.Context) ([]models.InstalledStudioPluginState, error)
	DeleteInstalledStudioPlugin(context.Context, string, string) error
	SaveTrustState(context.Context, models.TrustState) error
	ReadTrustState(context.Context, string) (models.TrustState, error)
	SaveEditorAssociation(context.Context, models.EditorAssociation) error
	ListEditorAssociations(context.Context) ([]models.EditorAssociation, error)
	DeleteEditorAssociation(context.Context, string) error
}
