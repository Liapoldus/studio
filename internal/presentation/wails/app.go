// Package wails exposes Studio use cases to the desktop frontend.
package wails

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/Liapoldus/studio/internal/application/product"
	workspaceapp "github.com/Liapoldus/studio/internal/application/workspace"
	"github.com/Liapoldus/studio/internal/domain/interfaces"
	"github.com/Liapoldus/studio/internal/domain/models"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	cli           interfaces.CLIRunner
	diagnostics   interfaces.DiagnosticStore
	state         interfaces.ProjectStateStore
	reports       interfaces.ReportStore
	editor        interfaces.ExternalEditorLauncher
	files         interfaces.FileSystem
	settings      interfaces.SettingsStore
	plugins       interfaces.StudioPluginHost
	git           interfaces.GitRepository
	desktop       interfaces.DesktopStore
	ctx           context.Context
	productInfo   *product.ProductInfo
	cliCancel     context.CancelFunc
	workspace     *workspaceapp.Service
	cliGeneration uint64
	cliMu         sync.Mutex
}

func NewApp(productInfo *product.ProductInfo, workspace *workspaceapp.Service, editor interfaces.ExternalEditorLauncher, files interfaces.FileSystem, settings interfaces.SettingsStore, cli interfaces.CLIRunner, reports interfaces.ReportStore, diagnostics interfaces.DiagnosticStore, plugins interfaces.StudioPluginHost, git interfaces.GitRepository, state interfaces.ProjectStateStore, desktop interfaces.DesktopStore) *App {
	return &App{productInfo: productInfo, workspace: workspace, editor: editor, files: files, settings: settings, cli: cli, diagnostics: diagnostics, reports: reports, plugins: plugins, git: git, state: state, desktop: desktop}
}

func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) ProductInfo() (models.ProductInfo, error) {
	return a.productInfo.Execute(a.context())
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
		Theme string `json:"theme"`
	}{Theme: state.Theme})
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

func (a *App) ListProjects() ([]models.Project, error) {
	return a.workspace.ListProjects(a.context())
}

func (a *App) OpenProject(root string) (models.Workspace, error) {
	return a.workspace.Open(a.context(), root)
}

func (a *App) SelectProjectDirectory() (string, error) {
	if a.ctx == nil {
		return "", nil
	}
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{Title: "Open Liapoldus Project"})
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

// RunCLI starts one allowlisted CLI command. Events are delivered through the
// desktop event bus; credentials and Core transport remain CLI-owned.
func (a *App) RunCLI(args []string) error {
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
	if err != nil {
		if status.State == "failed" {
			if root, rootErr := a.currentProjectRoot(); rootErr == nil {
				a.recordDiagnostic(root, models.Diagnostic{Owner: "studio-plugin", Code: status.ErrorCode, Severity: "error", Message: "Studio plugin process failed"})
			}
		}
		return string(data), err
	}
	return string(data), nil
}

func (a *App) GitDiff(path string) (models.GitDiff, error) {
	root, err := a.currentProjectRoot()
	if err != nil || a.git == nil {
		return models.GitDiff{}, models.ErrInvalidProject
	}
	return a.git.Diff(a.context(), root, path)
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
