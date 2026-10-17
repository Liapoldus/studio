package interfaces

import (
	"context"

	"github.com/Liapoldus/studio/internal/domain/models"
)

type StudioPluginPackageInstaller interface {
	Inspect(context.Context, string) (models.StudioPluginInspection, error)
	Install(context.Context, string, models.TrustDecision) (models.InstalledStudioPlugin, error)
}

type CompanionToolRunner interface {
	Run(context.Context, models.ToolExecutionRequest) (models.ToolExecutionResult, error)
}

type StudioPluginHost interface {
	Inspect(context.Context, string) (models.StudioPluginInspection, error)
	Install(context.Context, string, models.TrustDecision) (models.InstalledStudioPlugin, error)
	Remove(context.Context, string, string) error
	List(context.Context) ([]models.InstalledStudioPluginState, error)
	Manifests(context.Context) ([]models.StudioPluginInspection, error)
	Surface(context.Context, string, string, string) (string, error)
	SurfaceAsset(context.Context, string, string, string, string) ([]byte, string, error)
	RunTool(context.Context, string, string, string, string, []string) (models.ToolExecutionResult, error)
	StartProcess(context.Context, string, string, string) (models.StudioPluginProcessStatus, error)
	StopProcess(context.Context, string, string) error
	ProcessStatus(context.Context, string, string) (models.StudioPluginProcessStatus, error)
}
