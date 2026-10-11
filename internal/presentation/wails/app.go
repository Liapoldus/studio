// Package wails exposes Studio use cases to the desktop frontend.
package wails

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	cliplan "github.com/Liapoldus/studio/internal/application/cli"
	"github.com/Liapoldus/studio/internal/application/product"
	workspaceapp "github.com/Liapoldus/studio/internal/application/workspace"
	"github.com/Liapoldus/studio/internal/domain/interfaces"
	"github.com/Liapoldus/studio/internal/domain/models"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	git           interfaces.GitRepository
	graph         interfaces.GraphRepository
	desktop       interfaces.DesktopStore
	state         interfaces.ProjectStateStore
	toolchain     interfaces.ToolchainProbe
	editor        interfaces.ExternalEditorLauncher
	files         interfaces.FileSystem
	settings      interfaces.SettingsStore
	plugins       interfaces.StudioPluginHost
	diagnostics   interfaces.DiagnosticStore
	cli           interfaces.CLIRunner
	reports       interfaces.ReportStore
	ctx           context.Context
	productInfo   *product.ProductInfo
	cliCancel     context.CancelFunc
	workspace     *workspaceapp.Service
	pluginDiag    map[string]string
	cliGeneration uint64
	cliMu         sync.Mutex
	pluginDiagMu  sync.Mutex
}

func NewApp(productInfo *product.ProductInfo, workspace *workspaceapp.Service, editor interfaces.ExternalEditorLauncher, files interfaces.FileSystem, settings interfaces.SettingsStore, cli interfaces.CLIRunner, reports interfaces.ReportStore, diagnostics interfaces.DiagnosticStore, plugins interfaces.StudioPluginHost, git interfaces.GitRepository, toolchain interfaces.ToolchainProbe, state interfaces.ProjectStateStore, desktop interfaces.DesktopStore, dependencies ...any) *App {
	var graphRepository interfaces.GraphRepository
	for _, dependency := range dependencies {
		if value, ok := dependency.(interfaces.GraphRepository); ok {
			graphRepository = value
		}
	}
	return &App{productInfo: productInfo, workspace: workspace, editor: editor, files: files, settings: settings, cli: cli, diagnostics: diagnostics, reports: reports, plugins: plugins, git: git, graph: graphRepository, toolchain: toolchain, state: state, desktop: desktop, pluginDiag: make(map[string]string)}
}

func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) ProductInfo() (models.ProductInfo, error) {
	return a.productInfo.Execute(a.context())
}

// ToolchainStatus reports only local liapoldus executable availability and
// version. Studio does not inspect Core state or credentials in Home.
func (a *App) ToolchainStatus() models.ToolchainStatus {
	if a.toolchain == nil {
		return models.ToolchainStatus{ErrorCode: "cli.unavailable"}
	}
	return a.toolchain.Status(a.context())
}

func (a *App) ClientPreferences() (string, error) {
	if a.desktop == nil {
		return `{"theme":"system"}`, nil
	}
	state, err := a.desktop.ReadClientState(a.context())
	if err != nil {
		return "", err
	}
	data, err := json.Marshal(struct {
		Theme  string `json:"theme"`
		Locale string `json:"locale"`
	}{Theme: state.Theme, Locale: state.Locale})
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (a *App) SaveClientPreferences(theme string) error {
	if a.desktop == nil {
		return models.ErrInvalidTheme
	}
	normalized, err := models.NormalizeTheme(strings.TrimSpace(theme))
	if err != nil {
		return err
	}
	return a.desktop.SaveClientState(a.context(), models.ClientState{Theme: normalized})
}

func (a *App) SaveClientLocale(locale string) error {
	if a.desktop == nil {
		return models.ErrInvalidLocale
	}
	normalized, err := models.NormalizeLocale(strings.TrimSpace(locale))
	if err != nil {
		return err
	}
	return a.desktop.SaveClientState(a.context(), models.ClientState{Locale: normalized})
}

func (a *App) ListProjects() ([]models.Project, error) {
	return a.workspace.ListProjects(a.context())
}

func (a *App) OpenProject(root string) (models.Workspace, error) {
	return a.workspace.Open(a.context(), root)
}

func (a *App) CreateProject(root, id, name string) (models.Workspace, error) {
	return a.workspace.Create(a.context(), root, id, name)
}

func (a *App) SelectProjectDirectory() (string, error) {
	if a.ctx == nil {
		return "", nil
	}
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{Title: "Open Liapoldus Project"})
}

func (a *App) SelectProjectCreationDirectory() (string, error) {
	if a.ctx == nil {
		return "", nil
	}
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{Title: "Choose a parent folder for the new Liapoldus Project"})
}

// SelectTargetProfile returns a project-relative non-secret target profile path.
// The profile contents remain owned by liapoldus; Studio only supplies the path.
func (a *App) SelectTargetProfile() (string, error) {
	if a.ctx == nil {
		return "", nil
	}
	workspace, err := a.workspace.Current(a.context())
	if err != nil || workspace.Project == nil {
		return "", models.ErrInvalidProject
	}
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   "Choose local target profile",
		Filters: []runtime.FileFilter{{DisplayName: "Target profile", Pattern: "*.json;*.yaml;*.yml"}},
	})
	if err != nil || path == "" {
		return path, err
	}
	relative, err := filepath.Rel(workspace.Project.RootPath, filepath.Clean(path))
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
		return "", models.ErrInvalidProject
	}
	return filepath.ToSlash(relative), nil
}

// SelectRuntimeArtifactBinary chooses an already-built operator-owned binary.
// Studio never compiles it and never copies it into the Project.
func (a *App) SelectRuntimeArtifactBinary() (string, error) {
	if a.ctx == nil {
		return "", nil
	}
	// Do not filter by the host OS executable type: runtime artifacts may be
	// Linux ELF binaries selected from macOS or Windows. The CLI validates the
	// binary digest and declared target platform after selection.
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{Title: "Choose runtime plugin binary"})
}

func (a *App) Workspace() (models.Workspace, error) {
	return a.workspace.Current(a.context())
}

func (a *App) ReadWorkspaceState() (models.WorkspaceState, error) {
	workspace, err := a.workspace.Current(a.context())
	if err != nil || workspace.Project == nil || a.state == nil {
		return models.WorkspaceState{}, models.ErrInvalidProject
	}
	return a.state.Read(a.context(), workspace.Project.RootPath, workspace.Project.ID)
}

func (a *App) WriteWorkspaceState(value models.WorkspaceState) error {
	workspace, err := a.workspace.Current(a.context())
	if err != nil || workspace.Project == nil || a.state == nil || value.ProjectID != workspace.Project.ID {
		return models.ErrInvalidProject
	}
	return a.state.Save(a.context(), workspace.Project.RootPath, value)
}

func (a *App) OpenFileExternally(path, application string) error {
	workspace, err := a.workspace.Current(a.context())
	if err != nil {
		return err
	}
	if workspace.Project == nil || a.editor == nil {
		return models.ErrInvalidProject
	}
	if strings.TrimSpace(application) == "" && a.desktop != nil {
		associations, associationErr := a.desktop.ListEditorAssociations(a.context())
		if associationErr != nil {
			return associationErr
		}
		for _, association := range associations {
			matched, matchErr := matchesEditorAssociation(association.Pattern, path)
			if matchErr == nil && matched {
				application = association.Application
				break
			}
		}
	}
	return a.editor.Open(a.context(), workspace.Project.RootPath, path, application)
}

func matchesEditorAssociation(pattern, relativePath string) (bool, error) {
	matched, err := filepath.Match(pattern, relativePath)
	if err != nil || matched {
		return matched, err
	}
	return filepath.Match(pattern, filepath.Base(relativePath))
}

// EditorAssociations returns the host-owned file association table as JSON so
// the renderer never receives a direct storage handle.
func (a *App) EditorAssociations() (string, error) {
	if a.desktop == nil {
		return "[]", nil
	}
	associations, err := a.desktop.ListEditorAssociations(a.context())
	if err != nil {
		return "", err
	}
	data, err := json.Marshal(associations)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// SaveEditorAssociation stores an explicit project-independent association.
// The application value is an executable or native application path, never a
// shell command with arguments.
func (a *App) SaveEditorAssociation(pattern, application string) error {
	pattern = strings.TrimSpace(pattern)
	application = strings.TrimSpace(application)
	if a.desktop == nil || pattern == "" || application == "" || strings.ContainsAny(pattern, "\x00\r\n") || strings.ContainsAny(application, "\x00\r\n") {
		return models.ErrInvalidProject
	}
	return a.desktop.SaveEditorAssociation(a.context(), models.EditorAssociation{Pattern: pattern, Application: application})
}

// SelectExternalEditor opens the native picker used to choose an executable or
// application bundle. It does not execute the selected application.
func (a *App) SelectExternalEditor() (string, error) {
	if a.ctx == nil {
		return "", nil
	}
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   "Choose external editor",
		Filters: []runtime.FileFilter{{DisplayName: "Applications and executables", Pattern: "*.app;*.exe;*"}},
	})
}

func (a *App) ReadProjectFile(path string) ([]byte, error) {
	workspace, err := a.workspace.Current(a.context())
	if err != nil {
		return nil, err
	}
	if workspace.Project == nil || a.files == nil {
		return nil, models.ErrInvalidProject
	}
	return a.files.ReadFile(a.context(), workspace.Project.RootPath, path)
}

func (a *App) WriteProjectFile(path string, content []byte) error {
	workspace, err := a.workspace.Current(a.context())
	if err != nil {
		return err
	}
	if workspace.Project == nil || a.files == nil {
		return models.ErrInvalidProject
	}
	return a.files.WriteFile(a.context(), workspace.Project.RootPath, path, content)
}

func (a *App) ReadProjectSettings(settingsPath, schemaPath string) ([]byte, error) {
	workspace, err := a.workspace.Current(a.context())
	if err != nil {
		return nil, err
	}
	if workspace.Project == nil || a.settings == nil {
		return nil, models.ErrInvalidProject
	}
	return a.settings.Read(a.context(), workspace.Project.RootPath, settingsPath, schemaPath)
}

func (a *App) ReadProjectSchema(schemaPath string) ([]byte, error) {
	workspace, err := a.workspace.Current(a.context())
	if err != nil {
		return nil, err
	}
	if workspace.Project == nil || a.settings == nil {
		return nil, models.ErrInvalidProject
	}
	return a.settings.ReadSchema(a.context(), workspace.Project.RootPath, schemaPath)
}

func (a *App) WriteProjectSettings(settingsPath, schemaPath string, patch []byte) error {
	workspace, err := a.workspace.Current(a.context())
	if err != nil {
		return err
	}
	if workspace.Project == nil || a.settings == nil {
		return models.ErrInvalidProject
	}
	return a.settings.Update(a.context(), workspace.Project.RootPath, settingsPath, schemaPath, patch)
}

// RunCLI is retained for generated-binding compatibility during migration. New
// UI code must use RunStudioCommand so it cannot submit arbitrary argv.
func (a *App) RunCLI(args []string) error {
	return a.runCLIArgs(args)
}

// RunStudioCommand converts a reviewed intent into a project-scoped CLI call.
// Credentials and Core transport remain owned by liapoldus.
func (a *App) RunStudioCommand(command, target, operationID, profilePath string) error {
	workspace, err := a.workspace.Current(a.context())
	if err != nil {
		return err
	}
	if workspace.Project == nil || a.cli == nil {
		return models.ErrInvalidProject
	}
	args, err := cliplan.Plan(models.CLIIntent{Command: command, Target: target, OperationID: operationID, ProfilePath: profilePath}, workspace.Project.RootPath)
	if err != nil {
		return err
	}
	return a.runCLIArgs(args)
}

func (a *App) RunStudioRuntimeCommand(command, serviceID string) error {
	workspace, err := a.workspace.Current(a.context())
	if err != nil || workspace.Project == nil || a.cli == nil {
		return models.ErrInvalidProject
	}
	args, err := cliplan.Plan(models.CLIIntent{Command: command, Target: "local", ServiceID: serviceID}, workspace.Project.RootPath)
	if err != nil {
		return err
	}
	return a.runCLIArgs(args)
}

func (a *App) ListRuntimeArtifacts() ([]models.ArtifactReference, error) {
	value, err := a.runCLIJSON(models.CLIIntent{Command: "plugin.artifact.list"})
	if err != nil {
		return nil, err
	}
	var artifacts []models.ArtifactReference
	if err := json.Unmarshal(value, &artifacts); err != nil {
		return nil, err
	}
	return artifacts, nil
}

func (a *App) RegisterRuntimeArtifact(id, version, platform, binaryPath string) (models.ArtifactReference, error) {
	if !filepath.IsAbs(binaryPath) || strings.ContainsAny(binaryPath, "\x00\r\n") {
		return models.ArtifactReference{}, models.ErrInvalidProject
	}
	value, err := a.runCLIJSON(models.CLIIntent{Command: "plugin.artifact.register", ArtifactID: id, Version: version, Platform: platform, BinaryPath: binaryPath})
	if err != nil {
		return models.ArtifactReference{}, err
	}
	var artifact models.ArtifactReference
	if err := json.Unmarshal(value, &artifact); err != nil {
		return models.ArtifactReference{}, err
	}
	return artifact, nil
}

func (a *App) TrustRuntimeArtifact(id, version, platform, digest string) (models.ArtifactReference, error) {
	value, err := a.runCLIJSON(models.CLIIntent{Command: "plugin.artifact.trust", ArtifactID: id, Version: version, Platform: platform, Digest: digest})
	if err != nil {
		return models.ArtifactReference{}, err
	}
	var artifact models.ArtifactReference
	if err := json.Unmarshal(value, &artifact); err != nil {
		return models.ArtifactReference{}, err
	}
	return artifact, nil
}

// ReadRuntimePluginMetadata is Core-backed. Studio never receives a plugin
// SDK client or calls a plugin control URL; liapoldus asks Core for the view.
func (a *App) ReadRuntimePluginMetadata(pluginID, view string) (string, error) {
	value, err := a.runCLIJSON(models.CLIIntent{Command: "plugin." + view, Target: "local", ArtifactID: pluginID})
	if err != nil {
		return "", err
	}
	return string(value), nil
}

func (a *App) runCLIJSON(intent models.CLIIntent) (json.RawMessage, error) {
	workspace, err := a.workspace.Current(a.context())
	if err != nil {
		return nil, err
	}
	if workspace.Project == nil || a.cli == nil {
		return nil, models.ErrInvalidProject
	}
	args, err := cliplan.Plan(intent, workspace.Project.RootPath)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(a.context(), 60*time.Second)
	defer cancel()
	events, err := a.cli.Run(ctx, models.CLIRequest{ProjectRoot: workspace.Project.RootPath, WorkingDir: workspace.Project.RootPath, Args: args})
	if err != nil {
		return nil, err
	}
	return structuredCLIResult(events)
}

func structuredCLIResult(events <-chan models.CLIEvent) (json.RawMessage, error) {
	var payload json.RawMessage
	var failure string
	var diagnostic string
	completed := false
	for event := range events {
		switch event.Type {
		case "run.output":
			if len(event.Payload) > 0 {
				payload = append(json.RawMessage(nil), event.Payload...)
			}
		case "diagnostic":
			if event.Severity == "error" {
				parts := []string{strings.TrimSpace(event.Code), strings.TrimSpace(event.Message)}
				diagnostic = strings.Trim(strings.Join(parts, ": "), ": ")
			}
		case "run.failed":
			parts := []string{strings.TrimSpace(event.Code), strings.TrimSpace(event.Message)}
			failure = strings.Trim(strings.Join(parts, ": "), ": ")
			if failure == "" {
				failure = "CLI command failed"
			}
		case "run.completed":
			completed = true
		}
	}
	if failure != "" {
		return nil, fmt.Errorf("liapoldus: %s", failure)
	}
	if len(payload) == 0 {
		if diagnostic != "" {
			return nil, fmt.Errorf("liapoldus: %s", diagnostic)
		}
		if completed {
			return nil, errors.New("liapoldus completed without a structured result")
		}
		return nil, errors.New("liapoldus event stream ended without a structured result")
	}
	return payload, nil
}

func (a *App) runCLIArgs(args []string) error {
	workspace, err := a.workspace.Current(a.context())
	if err != nil {
		return err
	}
	if workspace.Project == nil || a.cli == nil {
		return models.ErrInvalidProject
	}
	runContext, cancel := context.WithCancel(a.context())
	a.cliMu.Lock()
	if a.cliCancel != nil {
		a.cliCancel()
	}
	a.cliGeneration++
	generation := a.cliGeneration
	a.cliCancel = cancel
	a.cliMu.Unlock()
	events, err := a.cli.Run(runContext, models.CLIRequest{
		ProjectRoot: workspace.Project.RootPath,
		WorkingDir:  workspace.Project.RootPath,
		Args:        args,
	})
	if err != nil {
		cancel()
		a.clearCLICancel(generation)
		return err
	}
	go func() {
		defer a.clearCLICancel(generation)
		for event := range events {
			if event.Type == "diagnostic" || event.Type == "run.failed" {
				a.recordDiagnostic(workspace.Project.RootPath, models.Diagnostic{Owner: "cli", Code: event.Code, Severity: event.Severity, Message: event.Message, OperationID: event.OperationID, Target: event.Target})
			}
			if event.Type == "report.available" && event.ReportPath != "" {
				if importErr := a.importReport(event.ReportPath); importErr != nil {
					event = models.CLIEvent{
						SchemaVersion: "cli-events/v1",
						Type:          "diagnostic",
						Severity:      "error",
						Code:          "report.import",
						Message:       "CLI report could not be imported",
					}
					a.recordDiagnostic(workspace.Project.RootPath, models.Diagnostic{Owner: "report", Code: "report.import", Severity: "error", Message: "CLI report could not be imported"})
				}
			}
			runtime.EventsEmit(a.context(), "studio.cli.event", event)
		}
	}()
	return nil
}

func (a *App) InitializeGit() (models.Workspace, error) {
	workspace, err := a.workspace.Current(a.context())
	if err != nil || workspace.Project == nil || a.git == nil {
		return models.Workspace{}, models.ErrInvalidProject
	}
	if err := a.git.Init(a.context(), workspace.Project.RootPath); err != nil {
		return models.Workspace{}, err
	}
	return a.workspace.Open(a.context(), workspace.Project.RootPath)
}

func (a *App) CreateRuntimePlugin(input models.RuntimePluginInput) (models.Workspace, error) {
	workspace, err := a.workspace.Current(a.context())
	if err != nil || workspace.Project == nil || a.graph == nil {
		return models.Workspace{}, models.ErrInvalidProject
	}
	if err := a.graph.CreateRuntimePlugin(a.context(), workspace.Project.RootPath, input); err != nil {
		return models.Workspace{}, err
	}
	return a.workspace.Open(a.context(), workspace.Project.RootPath)
}

func (a *App) DeleteRuntimePlugin(id string, confirmed bool) (models.Workspace, error) {
	workspace, err := a.workspace.Current(a.context())
	if err != nil || workspace.Project == nil || a.graph == nil {
		return models.Workspace{}, models.ErrInvalidProject
	}
	if err := a.graph.DeleteRuntimePlugin(a.context(), workspace.Project.RootPath, id, confirmed); err != nil {
		return models.Workspace{}, err
	}
	return a.workspace.Open(a.context(), workspace.Project.RootPath)
}

func (a *App) CreatePluginLink(input models.PluginLinkInput) (models.Workspace, error) {
	workspace, err := a.workspace.Current(a.context())
	if err != nil || workspace.Project == nil || a.graph == nil {
		return models.Workspace{}, models.ErrInvalidProject
	}
	if err := a.graph.CreatePluginLink(a.context(), workspace.Project.RootPath, input); err != nil {
		return models.Workspace{}, err
	}
	return a.workspace.Open(a.context(), workspace.Project.RootPath)
}

func (a *App) DeletePluginLink(caller, id string, confirmed bool) (models.Workspace, error) {
	workspace, err := a.workspace.Current(a.context())
	if err != nil || workspace.Project == nil || a.graph == nil {
		return models.Workspace{}, models.ErrInvalidProject
	}
	if err := a.graph.DeletePluginLink(a.context(), workspace.Project.RootPath, caller, id, confirmed); err != nil {
		return models.Workspace{}, err
	}
	return a.workspace.Open(a.context(), workspace.Project.RootPath)
}

func (a *App) Diagnostics() ([]models.Diagnostic, error) {
	root, err := a.currentProjectRoot()
	if err != nil {
		return nil, err
	}
	if a.diagnostics == nil {
		return []models.Diagnostic{}, nil
	}
	return a.diagnostics.List(a.context(), root)
}

func (a *App) recordDiagnostic(root string, diagnostic models.Diagnostic) {
	if a.diagnostics == nil || strings.TrimSpace(diagnostic.Code) == "" {
		return
	}
	if appendErr := a.diagnostics.Append(a.context(), root, diagnostic); appendErr != nil {
		return
	}
}

func (a *App) CancelCLI() {
	a.cliMu.Lock()
	cancel := a.cliCancel
	a.cliCancel = nil
	a.cliMu.Unlock()
	if cancel != nil {
		cancel()
	}
}

// PrepareRemoteHandoff returns a credential-free, revision-pinned CLI handoff.
// Studio never executes this remote command; CLI/CI owns the actual deployment.
func (a *App) PrepareRemoteHandoff(target string) (string, error) {
	workspace, err := a.workspace.Current(a.context())
	if err != nil || workspace.Project == nil || a.git == nil {
		return "", models.ErrInvalidCLIHandoff
	}
	if strings.TrimSpace(target) == "" || strings.EqualFold(strings.TrimSpace(target), "local") || !workspace.Git.Available || workspace.Git.Dirty || workspace.Git.Conflict {
		return "", models.ErrInvalidCLIHandoff
	}
	handoff := models.CLIHandoff{
		SchemaVersion: "studio-cli-handoff/v1",
		ProjectID:     workspace.Project.ID,
		Repository:    workspace.Project.RootPath,
		CommitSHA:     workspace.Git.Revision,
		Target:        target,
		Args:          []string{"apply", "--target", target, "--revision", workspace.Git.Revision},
	}
	if validateErr := handoff.Validate(); validateErr != nil {
		return "", validateErr
	}
	data, err := json.MarshalIndent(handoff, "", "  ")
	if err != nil {
		return "", models.ErrInvalidCLIHandoff
	}
	return string(data), nil
}

func (a *App) clearCLICancel(generation uint64) {
	a.cliMu.Lock()
	defer a.cliMu.Unlock()
	if a.cliGeneration == generation {
		a.cliCancel = nil
	}
}

// TrafficRecords returns only the redacted observation projection persisted by
// the report store. Studio never turns this into a live Core connection.
func (a *App) TrafficRecords() ([]models.TrafficRecordView, error) {
	workspace, err := a.workspace.Current(a.context())
	if err != nil {
		return nil, err
	}
	if workspace.Project == nil || a.reports == nil {
		return []models.TrafficRecordView{}, nil
	}
	reports, err := a.reports.List(a.context(), workspace.Project.RootPath)
	if err != nil {
		return nil, err
	}
	return trafficViews(reports)
}

// ExportTrafficReport writes the already redacted traffic projection to a
// user-selected file. The export never reads Core directly and never exposes
// the raw report payloads stored on disk.
func (a *App) ExportTrafficReport() (string, error) {
	if a.ctx == nil {
		return "", nil
	}
	records, err := a.TrafficRecords()
	if err != nil {
		return "", err
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Export redacted traffic report",
		DefaultFilename: "liapoldus-traffic-report.json",
		Filters:         []runtime.FileFilter{{DisplayName: "JSON report", Pattern: "*.json"}},
	})
	if err != nil || path == "" {
		return path, err
	}
	data, err := json.MarshalIndent(struct {
		SchemaVersion string                     `json:"schemaVersion"`
		Records       []models.TrafficRecordView `json:"records"`
	}{SchemaVersion: "studio-traffic-export/v1", Records: records}, "", "  ")
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Clean(path), data, 0600); err != nil {
		return "", err
	}
	return filepath.Clean(path), nil
}

func (a *App) SelectStudioPluginPackage() (string, error) {
	if a.ctx == nil {
		return "", nil
	}
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   "Import Studio plugin",
		Filters: []runtime.FileFilter{{DisplayName: "Studio plugin", Pattern: "*.studio-plugin"}},
	})
}

func (a *App) InspectStudioPlugin(packagePath string) (string, error) {
	if a.plugins == nil {
		return "", models.ErrInvalidStudioPlugin
	}
	inspection, err := a.plugins.Inspect(a.context(), packagePath)
	if err != nil {
		return "", err
	}
	data, err := json.Marshal(inspection)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (a *App) InstallStudioPlugin(packagePath string, approved bool, reason string, grantedPermissions []string) (string, error) {
	if a.plugins == nil {
		return "", models.ErrInvalidStudioPlugin
	}
	installed, err := a.plugins.Install(a.context(), packagePath, models.TrustDecision{Approved: approved, Reason: reason, GrantedPermissions: grantedPermissions})
	if err != nil {
		return "", err
	}
	data, err := json.Marshal(installed)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (a *App) InstalledStudioPlugins() ([]models.InstalledPluginState, error) {
	if a.plugins == nil {
		return []models.InstalledPluginState{}, nil
	}
	return a.plugins.List(a.context())
}

func (a *App) RemoveStudioPlugin(id, version string) error {
	if a.plugins == nil {
		return models.ErrInvalidStudioPlugin
	}
	return a.plugins.Remove(a.context(), id, version)
}

func (a *App) InstalledStudioPluginManifests() (string, error) {
	if a.plugins == nil {
		return "[]", nil
	}
	manifests, err := a.plugins.Manifests(a.context())
	if err != nil {
		return "", err
	}
	data, err := json.Marshal(manifests)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (a *App) ReadStudioPluginSurface(id, version, surfaceID string) (string, error) {
	if a.plugins == nil {
		return "", models.ErrInvalidStudioPlugin
	}
	return a.plugins.Surface(a.context(), id, version, surfaceID)
}

// RunStudioPluginTool executes only a tool declared by a verified installed
// package. The plugin host owns executable validation, timeout and redaction;
// the renderer receives a JSON result, never a process handle or environment.
func (a *App) RunStudioPluginTool(id, version, toolID string, args []string) (string, error) {
	workspace, err := a.workspace.Current(a.context())
	if err != nil || workspace.Project == nil || a.plugins == nil {
		return "", models.ErrInvalidProject
	}
	result, err := a.plugins.RunTool(a.context(), id, version, toolID, workspace.Project.RootPath, args)
	data, marshalErr := json.Marshal(result)
	if marshalErr != nil {
		return "", marshalErr
	}
	if err != nil {
		a.recordDiagnostic(workspace.Project.RootPath, models.Diagnostic{Owner: "studio-plugin", Code: "plugin.tool", Severity: "error", Message: "Studio plugin tool failed"})
		return string(data), err
	}
	return string(data), nil
}

func (a *App) StartStudioPluginProcess(id, version string) (string, error) {
	workspace, err := a.workspace.Current(a.context())
	if err != nil || workspace.Project == nil || a.plugins == nil {
		return "", models.ErrInvalidProject
	}
	status, err := a.plugins.StartProcess(a.context(), id, version, workspace.Project.RootPath)
	data, marshalErr := json.Marshal(status)
	if marshalErr != nil {
		return "", marshalErr
	}
	if err != nil {
		a.recordDiagnostic(workspace.Project.RootPath, models.Diagnostic{Owner: "studio-plugin", Code: "plugin.process.start", Severity: "error", Message: "Studio plugin process failed to start"})
		return string(data), err
	}
	a.clearPluginProcessDiagnostic(id, version)
	return string(data), nil
}

func (a *App) StopStudioPluginProcess(id, version string) error {
	if a.plugins == nil {
		return models.ErrInvalidStudioPlugin
	}
	return a.plugins.StopProcess(a.context(), id, version)
}

func (a *App) StudioPluginProcessStatus(id, version string) (string, error) {
	if a.plugins == nil {
		return "", models.ErrInvalidStudioPlugin
	}
	status, err := a.plugins.ProcessStatus(a.context(), id, version)
	data, marshalErr := json.Marshal(status)
	if marshalErr != nil {
		return "", marshalErr
	}
	if status.State == "failed" {
		if root, rootErr := a.currentProjectRoot(); rootErr == nil {
			a.recordPluginProcessFailure(root, id, version, status.ErrorCode)
		}
	}
	if err != nil {
		return string(data), err
	}
	return string(data), nil
}

func (a *App) recordPluginProcessFailure(root, id, version, code string) {
	code = strings.TrimSpace(code)
	if code == "" {
		return
	}
	key := processDiagnosticKey(id, version)
	a.pluginDiagMu.Lock()
	if a.pluginDiag == nil {
		a.pluginDiag = make(map[string]string)
	}
	if a.pluginDiag[key] == code {
		a.pluginDiagMu.Unlock()
		return
	}
	a.pluginDiag[key] = code
	a.pluginDiagMu.Unlock()
	a.recordDiagnostic(root, models.Diagnostic{Owner: "studio-plugin", Code: code, Severity: "error", Message: "Studio plugin process failed"})
}

func (a *App) clearPluginProcessDiagnostic(id, version string) {
	a.pluginDiagMu.Lock()
	delete(a.pluginDiag, processDiagnosticKey(id, version))
	a.pluginDiagMu.Unlock()
}

func processDiagnosticKey(id, version string) string { return id + "@" + version }

func (a *App) GitDiff(path string) (models.GitDiff, error) {
	root, err := a.currentProjectRoot()
	if err != nil || a.git == nil {
		return models.GitDiff{}, models.ErrInvalidProject
	}
	return a.git.Diff(a.context(), root, path)
}

func (a *App) GitConflict(path string) (models.GitConflict, error) {
	root, err := a.currentProjectRoot()
	if err != nil || a.git == nil {
		return models.GitConflict{}, models.ErrInvalidProject
	}
	return a.git.Conflict(a.context(), root, path)
}

func (a *App) GitResolveConflict(path, side string, confirmed bool) error {
	root, err := a.currentProjectRoot()
	if err != nil || a.git == nil {
		return models.ErrInvalidProject
	}
	return a.git.ResolveConflict(a.context(), root, path, side, confirmed)
}

func (a *App) GitStage(paths []string, confirmed bool) error {
	root, err := a.currentProjectRoot()
	if err != nil || a.git == nil {
		return models.ErrInvalidProject
	}
	return a.git.Stage(a.context(), root, paths, confirmed)
}

func (a *App) GitUnstage(paths []string, confirmed bool) error {
	root, err := a.currentProjectRoot()
	if err != nil || a.git == nil {
		return models.ErrInvalidProject
	}
	return a.git.Unstage(a.context(), root, paths, confirmed)
}

func (a *App) GitCommitStaged(message string, confirmed bool) (string, error) {
	root, err := a.currentProjectRoot()
	if err != nil || a.git == nil {
		return "", models.ErrInvalidProject
	}
	return a.git.CommitStaged(a.context(), root, message, confirmed)
}

func (a *App) GitStashes(limit int) ([]models.GitStash, error) {
	root, err := a.currentProjectRoot()
	if err != nil || a.git == nil {
		return nil, models.ErrInvalidProject
	}
	return a.git.Stashes(a.context(), root, limit)
}

func (a *App) GitStash(message string, includeUntracked, confirmed bool) (string, error) {
	root, err := a.currentProjectRoot()
	if err != nil || a.git == nil {
		return "", models.ErrInvalidProject
	}
	return a.git.Stash(a.context(), root, message, includeUntracked, confirmed)
}

func (a *App) GitApplyStash(index int, drop, confirmed bool) error {
	root, err := a.currentProjectRoot()
	if err != nil || a.git == nil {
		return models.ErrInvalidProject
	}
	return a.git.ApplyStash(a.context(), root, index, drop, confirmed)
}

func (a *App) GitBranches() ([]models.GitBranch, error) {
	root, err := a.currentProjectRoot()
	if err != nil || a.git == nil {
		return nil, models.ErrInvalidProject
	}
	return a.git.Branches(a.context(), root)
}

func (a *App) GitHistory(limit int) ([]models.GitCommit, error) {
	root, err := a.currentProjectRoot()
	if err != nil || a.git == nil {
		return nil, models.ErrInvalidProject
	}
	return a.git.History(a.context(), root, limit)
}

func (a *App) GitRemotes() ([]models.GitRemote, error) {
	root, err := a.currentProjectRoot()
	if err != nil || a.git == nil {
		return nil, models.ErrInvalidProject
	}
	return a.git.Remotes(a.context(), root)
}

func (a *App) GitCheckout(branch string, confirmed bool) error {
	root, err := a.currentProjectRoot()
	if err != nil || a.git == nil {
		return models.ErrInvalidProject
	}
	return a.git.Checkout(a.context(), root, branch, confirmed)
}

func (a *App) GitCommit(message string, paths []string, confirmed bool) (string, error) {
	root, err := a.currentProjectRoot()
	if err != nil || a.git == nil {
		return "", models.ErrInvalidProject
	}
	return a.git.Commit(a.context(), root, message, paths, confirmed)
}

func (a *App) GitPull(remote, branch string, confirmed bool) error {
	root, err := a.currentProjectRoot()
	if err != nil || a.git == nil {
		return models.ErrInvalidProject
	}
	return a.git.Pull(a.context(), root, remote, branch, confirmed)
}

func (a *App) GitPush(remote, branch string, confirmed bool) error {
	root, err := a.currentProjectRoot()
	if err != nil || a.git == nil {
		return models.ErrInvalidProject
	}
	return a.git.Push(a.context(), root, remote, branch, confirmed)
}

func (a *App) GitMerge(branch string, confirmed bool) error {
	root, err := a.currentProjectRoot()
	if err != nil || a.git == nil {
		return models.ErrInvalidProject
	}
	return a.git.Merge(a.context(), root, branch, confirmed)
}

func (a *App) GitRebase(branch string, confirmed bool) error {
	root, err := a.currentProjectRoot()
	if err != nil || a.git == nil {
		return models.ErrInvalidProject
	}
	return a.git.Rebase(a.context(), root, branch, confirmed)
}

func (a *App) GitCherryPick(commit string, confirmed bool) error {
	root, err := a.currentProjectRoot()
	if err != nil || a.git == nil {
		return models.ErrInvalidProject
	}
	return a.git.CherryPick(a.context(), root, commit, confirmed)
}

func (a *App) GitAbort(operation string, confirmed bool) error {
	root, err := a.currentProjectRoot()
	if err != nil || a.git == nil {
		return models.ErrInvalidProject
	}
	return a.git.Abort(a.context(), root, operation, confirmed)
}

func (a *App) currentProjectRoot() (string, error) {
	workspace, err := a.workspace.Current(a.context())
	if err != nil {
		return "", err
	}
	if workspace.Project == nil {
		return "", models.ErrInvalidProject
	}
	return workspace.Project.RootPath, nil
}

func (a *App) importReport(path string) error {
	workspace, err := a.workspace.Current(a.context())
	if err != nil {
		return err
	}
	if workspace.Project == nil || a.files == nil || a.reports == nil {
		return models.ErrInvalidProject
	}
	path = filepath.Clean(path)
	if filepath.IsAbs(path) {
		relative, relErr := filepath.Rel(workspace.Project.RootPath, path)
		if relErr != nil || relative == ".." || len(relative) > 0 && relative[:1] == "." {
			return models.ErrInvalidProject
		}
		path = relative
	}
	var data []byte
	if strings.HasPrefix(filepath.ToSlash(path), ".studio/reports/") {
		data, err = readImportedReport(workspace.Project.RootPath, path)
	} else {
		data, err = a.files.ReadFile(a.context(), workspace.Project.RootPath, filepath.ToSlash(path))
	}
	if err != nil {
		return err
	}
	if len(data) > 32*1024*1024 {
		return errors.New("CLI report exceeds Studio import limit")
	}
	var report models.Report
	if unmarshalErr := json.Unmarshal(data, &report); unmarshalErr != nil {
		return unmarshalErr
	}
	if report.ProjectID == "" {
		report.ProjectID = workspace.Project.ID
	}
	if report.ProjectID != workspace.Project.ID {
		return errors.New("CLI report belongs to another project")
	}
	_, err = a.reports.Save(a.context(), workspace.Project.RootPath, report, nil)
	return err
}

func readImportedReport(root, relative string) ([]byte, error) {
	clean := filepath.Clean(filepath.FromSlash(relative))
	parts := strings.Split(clean, string(filepath.Separator))
	if len(parts) != 3 || parts[0] != ".studio" || parts[1] != "reports" || parts[2] == "" || !strings.HasSuffix(parts[2], ".json") {
		return nil, models.ErrInvalidProject
	}
	current := filepath.Clean(root)
	for _, part := range parts {
		current = filepath.Join(current, part)
		info, err := os.Lstat(current)
		if err != nil || info.Mode()&os.ModeSymlink != 0 {
			return nil, models.ErrInvalidProject
		}
	}
	return os.ReadFile(current)
}

func trafficViews(reports []models.Report) ([]models.TrafficRecordView, error) {
	result := make([]models.TrafficRecordView, 0)
	for _, report := range reports {
		for _, record := range report.Traffic {
			request, redactErr := models.RedactJSON(record.RequestPayload, nil)
			if redactErr != nil {
				return nil, redactErr
			}
			response, redactErr := models.RedactJSON(record.ResponsePayload, nil)
			if redactErr != nil {
				return nil, redactErr
			}
			result = append(result, models.TrafficRecordView{
				ReportOperationID: report.OperationID,
				ReportTarget:      report.Target,
				ReportCommitSHA:   report.CommitSHA,
				Timestamp:         record.Timestamp,
				CorrelationID:     record.CorrelationID,
				Caller:            record.Caller,
				Target:            record.Target,
				Method:            record.Method,
				Transport:         record.Transport,
				Status:            record.Status,
				SchemaValidation:  record.SchemaValidation,
				RequestPayload:    string(request),
				ResponsePayload:   string(response),
				LatencyMillis:     record.LatencyMillis,
				RequestSize:       record.RequestSize,
				ResponseSize:      record.ResponseSize,
			})
		}
	}
	return result, nil
}

func (a *App) context() context.Context {
	if a.ctx == nil {
		return context.Background()
	}
	return a.ctx
}
