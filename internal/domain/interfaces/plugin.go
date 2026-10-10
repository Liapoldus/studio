package interfaces

import (
	"context"

	"github.com/Liapoldus/studio/internal/domain/models"
)

type PluginPackageInstaller interface {
	Inspect(context.Context, string) (models.PluginInspection, error)
	Install(context.Context, string, models.TrustDecision) (models.InstalledPlugin, error)
}

type CompanionToolRunner interface {
	Run(context.Context, models.ToolExecutionRequest) (models.ToolExecutionResult, error)
}

type StudioPluginHost interface {
	Inspect(context.Context, string) (models.PluginInspection, error)
	Install(context.Context, string, models.TrustDecision) (models.InstalledPlugin, error)
	Remove(context.Context, string, string) error
	List(context.Context) ([]models.InstalledPluginState, error)
	Manifests(context.Context) ([]models.PluginInspection, error)
	Surface(context.Context, string, string, string) (string, error)
	RunTool(context.Context, string, string, string, string, []string) (models.ToolExecutionResult, error)
	StartProcess(context.Context, string, string, string) (models.PluginProcessStatus, error)
	StopProcess(context.Context, string, string) error
	ProcessStatus(context.Context, string, string) (models.PluginProcessStatus, error)
}
