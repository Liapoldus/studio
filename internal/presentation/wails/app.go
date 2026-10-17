// Package wails exposes Studio use cases to the desktop frontend.
package wails

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
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
	cli           interfaces.CLIRunner
	reports       interfaces.ReportStore
	desktop       interfaces.DesktopStore
	state         interfaces.ProjectStateStore
	toolchain     interfaces.ToolchainProbe
	cliInspector  interfaces.CLIExecutableInspector
	editor        interfaces.ExternalEditorLauncher
	files         interfaces.FileSystem
	settings      interfaces.SettingsStore
	plugins       interfaces.StudioPluginHost
	ctx           context.Context
	graph         interfaces.GraphRepository
	diagnostics   interfaces.DiagnosticStore
	productInfo   *product.ProductInfo
	cliCancel     context.CancelFunc
	workspace     *workspaceapp.Service
	pluginDiag    map[string]string
	cliRunID      string
	cliGeneration uint64
	cliMu         sync.Mutex
	pluginDiagMu  sync.Mutex
	settingsMu    sync.Mutex
}

var ErrCLICommandRunning = errors.New("a liapoldus CLI command is already running; wait for it or cancel it before starting another")

const cliCancelRunIDPrefix = "\x00cancel-requested:"

var ErrSchemaPreviewStale = errors.New("settings schema preview is stale; review the latest schema and settings again")

func NewApp(productInfo *product.ProductInfo, workspace *workspaceapp.Service, editor interfaces.ExternalEditorLauncher, files interfaces.FileSystem, settings interfaces.SettingsStore, cli interfaces.CLIRunner, reports interfaces.ReportStore, diagnostics interfaces.DiagnosticStore, plugins interfaces.StudioPluginHost, toolchain interfaces.ToolchainProbe, state interfaces.ProjectStateStore, desktop interfaces.DesktopStore, dependencies ...any) *App {
	var graphRepository interfaces.GraphRepository
	for _, dependency := range dependencies {
		if value, ok := dependency.(interfaces.GraphRepository); ok {
			graphRepository = value
		}
	}
	var inspector interfaces.CLIExecutableInspector
	if value, ok := toolchain.(interfaces.CLIExecutableInspector); ok {
		inspector = value
	}
	return &App{productInfo: productInfo, workspace: workspace, editor: editor, files: files, settings: settings, cli: cli, diagnostics: diagnostics, reports: reports, plugins: plugins, graph: graphRepository, toolchain: toolchain, cliInspector: inspector, state: state, desktop: desktop, pluginDiag: make(map[string]string)}
}

func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx
	if a.desktop != nil && strings.TrimSpace(os.Getenv("STUDIO_CLI_PATH")) == "" {
		if state, err := a.desktop.ReadClientState(ctx); err == nil && filepath.IsAbs(state.CLIPath) {
			if setErr := os.Setenv("STUDIO_CLI_PATH", state.CLIPath); setErr != nil {
				return
			}
		}
	}
}

func (a *App) ProductInfo() (models.ProductInfo, error) {
	return a.productInfo.Execute(a.context())
}

// ToolchainStatus verifies the local liapoldus typed command contract without
// inspecting Core state or credentials in Home.
func (a *App) ToolchainStatus() models.ToolchainStatus {
	if a.toolchain == nil {
		return models.ToolchainStatus{ErrorCode: "cli.unavailable"}
	}
	return a.toolchain.Status(a.context())
}

func (a *App) SelectCLIExecutable() (string, error) {
	if a.ctx == nil {
		return "", nil
	}
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{Title: "Choose liapoldus CLI executable"})
}

func (a *App) ConfigureCLIExecutable(path string) (models.ToolchainStatus, error) {
	if a.desktop == nil || a.cliInspector == nil {
		return models.ToolchainStatus{}, errors.New("CLI executable selection is unavailable")
	}
	path = filepath.Clean(strings.TrimSpace(path))
	status, err := a.cliInspector.Inspect(a.context(), path)
	if err != nil {
		return models.ToolchainStatus{}, err
	}
	previousPath, hadPrevious := os.LookupEnv("STUDIO_CLI_PATH")
	if err := os.Setenv("STUDIO_CLI_PATH", path); err != nil {
		return models.ToolchainStatus{}, errors.New("could not activate the selected CLI")
	}
	if err := a.desktop.SaveCLIPath(a.context(), path); err != nil {
		if restoreErr := restoreCLIExecutableEnv(previousPath, hadPrevious); restoreErr != nil {
			return models.ToolchainStatus{}, errors.Join(err, restoreErr)
		}
		return models.ToolchainStatus{}, err
	}
	if status.CLIPath != path {
		restoreErr := restoreCLIExecutableEnv(previousPath, hadPrevious)
		return models.ToolchainStatus{}, errors.Join(errors.New("selected CLI path did not validate"), restoreErr)
	}
	return status, nil
}

func restoreCLIExecutableEnv(path string, present bool) error {
	if present {
		return os.Setenv("STUDIO_CLI_PATH", path)
	}
	return os.Unsetenv("STUDIO_CLI_PATH")
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
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{Title: "Choose runtime service binary"})
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
		application, err = associatedEditor(associations, path)
		if err != nil {
			return err
		}
	}
	return a.editor.Open(a.context(), workspace.Project.RootPath, path, application)
}

func associatedEditor(associations []models.EditorAssociation, path string) (string, error) {
	application := ""
	bestSpecificity := -1
	for _, association := range associations {
		matched, err := matchesEditorAssociation(association.Pattern, path)
		if err != nil {
			return "", err
		}
		specificity := len(association.Pattern)
		if matched && specificity > bestSpecificity {
			application = association.Application
			bestSpecificity = specificity
		}
	}
	return application, nil
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

func (a *App) RemoveEditorAssociation(pattern string) error {
	pattern = strings.TrimSpace(pattern)
	if a.desktop == nil || pattern == "" || strings.ContainsAny(pattern, "\x00\r\n") {
		return models.ErrInvalidProject
	}
	if _, err := filepath.Match(pattern, "example.yaml"); err != nil {
		return models.ErrInvalidProject
	}
	return a.desktop.DeleteEditorAssociation(a.context(), pattern)
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

func (a *App) ReadProjectSettings(projectID, serviceID string) (string, error) {
	workspace, service, err := a.settingsService(projectID, serviceID)
	if err != nil {
		return "", err
	}
	snapshot, err := a.settings.Snapshot(a.context(), workspace.Project.RootPath, service.SettingsPath, service.SettingsSchemaPath)
	if err != nil {
		return "", err
	}
	encoded, err := json.Marshal(snapshot)
	return string(encoded), err
}

func (a *App) ReadProjectSchema(projectID, serviceID string) ([]byte, error) {
	workspace, service, err := a.settingsService(projectID, serviceID)
	if err != nil {
		return nil, err
	}
	return a.settings.ReadSchema(a.context(), workspace.Project.RootPath, service.SettingsSchemaPath)
}

// ImportServiceSettingsSchema fetches the live schema through the typed CLI
// (and therefore Core), validates it with the host schema rules, and creates
// the canonical Project schema only when the referenced file is absent.
func (a *App) ImportServiceSettingsSchema(projectID, serviceID string) (models.Workspace, error) {
	workspace, service, err := a.settingsService(projectID, serviceID)
	if err != nil || a.cli == nil || a.files == nil {
		return models.Workspace{}, models.ErrInvalidProject
	}
	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()
	if _, readErr := a.files.ReadFile(a.context(), workspace.Project.RootPath, service.SettingsSchemaPath); readErr == nil {
		return models.Workspace{}, os.ErrExist
	} else if !errors.Is(readErr, os.ErrNotExist) {
		return models.Workspace{}, readErr
	}
	value, err := a.runCLIJSONInWorkspaceWithTimeout(workspace, models.CLIIntent{
		Command: "service.schema", Target: "local", ServiceID: service.ID,
	}, 12*time.Second)
	if err != nil {
		return models.Workspace{}, err
	}
	if err := a.settings.ValidateSchemaDocument(a.context(), workspace.Project.RootPath, service.SettingsSchemaPath, value); err != nil {
		return models.Workspace{}, err
	}
	if err := a.files.CreateFile(a.context(), workspace.Project.RootPath, service.SettingsSchemaPath, value); err != nil {
		return models.Workspace{}, err
	}
	return a.workspace.OpenByID(a.context(), projectID)
}

// PreviewServiceSettingsSchema validates the current Project values plus the
// safe local draft against a fresh Core-backed schema. It returns a redacted
// schema projection, digests, and a compatibility flag, never settings values.
func (a *App) PreviewServiceSettingsSchema(projectID, serviceID, patchJSON string) (models.ServiceSettingsSchemaPreview, error) {
	workspace, service, err := a.settingsService(projectID, serviceID)
	if err != nil || a.cli == nil || a.files == nil || a.settings == nil {
		return models.ServiceSettingsSchemaPreview{}, models.ErrInvalidProject
	}
	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()
	schema, err := a.runCLIJSONInWorkspaceWithTimeout(workspace, models.CLIIntent{
		Command: "service.schema", Target: "local", ServiceID: service.ID,
	}, 12*time.Second)
	if err != nil {
		return models.ServiceSettingsSchemaPreview{}, err
	}
	if err = a.settings.ValidateSchemaDocument(a.context(), workspace.Project.RootPath, service.SettingsSchemaPath, schema); err != nil {
		return models.ServiceSettingsSchemaPreview{}, err
	}
	patch := []byte(patchJSON)
	snapshot, err := a.settings.Snapshot(a.context(), workspace.Project.RootPath, service.SettingsPath, service.SettingsSchemaPath)
	if err != nil {
		return models.ServiceSettingsSchemaPreview{}, err
	}
	previousSchema, err := a.files.ReadFile(a.context(), workspace.Project.RootPath, service.SettingsSchemaPath)
	if err != nil {
		return models.ServiceSettingsSchemaPreview{}, err
	}
	settingsDocument, readErr := a.files.ReadFile(a.context(), workspace.Project.RootPath, service.SettingsPath)
	if readErr != nil && !errors.Is(readErr, os.ErrNotExist) {
		return models.ServiceSettingsSchemaPreview{}, readErr
	}
	if errors.Is(readErr, os.ErrNotExist) {
		settingsDocument = []byte(`{}`)
	}
	previousSchemaDigest := fmt.Sprintf("sha256:%x", sha256.Sum256(previousSchema))
	var compatible bool
	migration, migrationFound, migrationErr := previewProjectSettingsVersionMigration(settingsDocument, schema)
	if migrationErr != nil {
		return models.ServiceSettingsSchemaPreview{}, migrationErr
	}
	preview := models.ServiceSettingsSchemaPreview{
		PreviousSchemaDigest: previousSchemaDigest,
		SettingsDigest:       snapshot.Digest,
		DraftDigest:          fmt.Sprintf("sha256:%x", sha256.Sum256(patch)),
	}
	if migrationFound {
		var draft map[string]json.RawMessage
		if json.Unmarshal(patch, &draft) != nil || len(draft) != 0 {
			return models.ServiceSettingsSchemaPreview{}, errors.New("save or discard the current settings draft before migrating its schema version")
		}
		compatible, err = a.settings.ValidateSettingsDocumentAgainstSchemaDocument(a.context(), workspace.Project.RootPath, service.SettingsSchemaPath, schema, migration.Candidate)
		if err != nil {
			return models.ServiceSettingsSchemaPreview{}, err
		}
		preview.MigrationRequired = true
		preview.MigrationFromVersion = migration.FromVersion
		preview.MigrationToVersion = migration.ToVersion
		preview.MigrationCandidateDigest = migration.CandidateDigest
		preview.MigrationChangedPaths = []string{"/schemaVersion"}
		preview.RecoveryCopyPath = settingsMigrationRecoveryPath(service, snapshot.Digest)
		preview.RecoverySchemaCopyPath = settingsMigrationSchemaRecoveryPath(service, snapshot.Digest)
	} else {
		compatible, err = a.settings.ValidateValuesAgainstSchemaDocument(a.context(), workspace.Project.RootPath, service.SettingsPath, service.SettingsSchemaPath, schema, patch)
		if err != nil {
			return models.ServiceSettingsSchemaPreview{}, err
		}
	}
	redactedSchema, err := a.settings.RedactSchemaDocument(a.context(), workspace.Project.RootPath, service.SettingsSchemaPath, schema)
	if err != nil {
		return models.ServiceSettingsSchemaPreview{}, err
	}
	preview.SchemaJSON = string(redactedSchema)
	preview.SchemaDigest = fmt.Sprintf("sha256:%x", sha256.Sum256(schema))
	preview.ValuesCompatible = compatible
	return preview, nil
}

// RefreshServiceSettingsSchema replaces only the derived Project schema after
// rechecking the exact schema, settings snapshot, and draft reviewed in preview.
func (a *App) RefreshServiceSettingsSchema(projectID, serviceID, previewJSON, patchJSON string) (models.Workspace, error) {
	workspace, service, err := a.settingsService(projectID, serviceID)
	if err != nil || a.cli == nil || a.files == nil || a.settings == nil {
		return models.Workspace{}, models.ErrInvalidProject
	}
	var preview models.ServiceSettingsSchemaPreview
	if len(previewJSON) > 2<<20 || decodeBoundedJSON([]byte(previewJSON), &preview) != nil ||
		!validSettingsDigest(preview.SchemaDigest) || !validSettingsDigest(preview.PreviousSchemaDigest) ||
		!validSettingsDigest(preview.SettingsDigest) || !validSettingsDigest(preview.DraftDigest) {
		return models.Workspace{}, ErrSchemaPreviewStale
	}
	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()
	schema, err := a.runCLIJSONInWorkspaceWithTimeout(workspace, models.CLIIntent{
		Command: "service.schema", Target: "local", ServiceID: service.ID,
	}, 12*time.Second)
	if err != nil {
		return models.Workspace{}, err
	}
	if err = a.settings.ValidateSchemaDocument(a.context(), workspace.Project.RootPath, service.SettingsSchemaPath, schema); err != nil {
		return models.Workspace{}, err
	}
	schemaDigest := fmt.Sprintf("sha256:%x", sha256.Sum256(schema))
	if schemaDigest != preview.SchemaDigest {
		return models.Workspace{}, ErrSchemaPreviewStale
	}
	previousSchema, err := a.files.ReadFile(a.context(), workspace.Project.RootPath, service.SettingsSchemaPath)
	if err != nil || fmt.Sprintf("sha256:%x", sha256.Sum256(previousSchema)) != preview.PreviousSchemaDigest {
		return models.Workspace{}, ErrSchemaPreviewStale
	}
	snapshot, err := a.settings.Snapshot(a.context(), workspace.Project.RootPath, service.SettingsPath, service.SettingsSchemaPath)
	if err != nil {
		return models.Workspace{}, err
	}
	if snapshot.Digest != preview.SettingsDigest || fmt.Sprintf("sha256:%x", sha256.Sum256([]byte(patchJSON))) != preview.DraftDigest {
		return models.Workspace{}, ErrSchemaPreviewStale
	}
	settingsDocument, settingsReadErr := a.files.ReadFile(a.context(), workspace.Project.RootPath, service.SettingsPath)
	if settingsReadErr != nil && !errors.Is(settingsReadErr, os.ErrNotExist) {
		return models.Workspace{}, settingsReadErr
	}
	if errors.Is(settingsReadErr, os.ErrNotExist) {
		settingsDocument = []byte(`{}`)
	}
	migration, migrationFound, migrationErr := previewProjectSettingsVersionMigration(settingsDocument, schema)
	if migrationErr != nil || migrationFound != preview.MigrationRequired {
		return models.Workspace{}, ErrSchemaPreviewStale
	}
	if preview.MigrationRequired {
		if preview.MigrationFromVersion <= 0 || preview.MigrationToVersion <= 0 ||
			preview.MigrationChangedPaths == nil || len(preview.MigrationChangedPaths) != 1 || preview.MigrationChangedPaths[0] != "/schemaVersion" ||
			!validSettingsDigest(preview.MigrationCandidateDigest) || preview.RecoveryCopyPath != settingsMigrationRecoveryPath(service, preview.SettingsDigest) ||
			preview.RecoverySchemaCopyPath != settingsMigrationSchemaRecoveryPath(service, preview.SettingsDigest) || patchJSON != `{}` {
			return models.Workspace{}, ErrSchemaPreviewStale
		}
		if migration.FromVersion != preview.MigrationFromVersion || migration.ToVersion != preview.MigrationToVersion || migration.CandidateDigest != preview.MigrationCandidateDigest {
			return models.Workspace{}, ErrSchemaPreviewStale
		}
		if err := writeSettingsMigrationRecoveryCopies(a, workspace.Project.RootPath, service, preview.SettingsDigest, settingsDocument, previousSchema); err != nil {
			return models.Workspace{}, err
		}
		if _, err := a.settings.ValidateValuesAgainstSchemaDocument(a.context(), workspace.Project.RootPath, service.SettingsPath, service.SettingsSchemaPath, schema, []byte(patchJSON)); err != nil {
			return models.Workspace{}, err
		}
		schemaWritten, schemaErr := a.files.WriteFileIfDigest(a.context(), workspace.Project.RootPath, service.SettingsSchemaPath, preview.PreviousSchemaDigest, schema)
		if schemaErr != nil || !schemaWritten {
			return models.Workspace{}, ErrSchemaPreviewStale
		}
		settingsWritten, settingsErr := a.files.WriteFileIfDigest(a.context(), workspace.Project.RootPath, service.SettingsPath, preview.SettingsDigest, migration.Candidate)
		if settingsErr != nil || !settingsWritten {
			rolledBack, rollbackErr := a.files.WriteFileIfDigest(a.context(), workspace.Project.RootPath, service.SettingsSchemaPath, preview.SchemaDigest, previousSchema)
			if settingsErr != nil {
				return models.Workspace{}, fmt.Errorf("schema migration failed; recovery copies are available in the Project: %w", settingsErr)
			}
			if !rolledBack || rollbackErr != nil {
				return models.Workspace{}, errors.New("schema migration did not complete; recovery copies are available in the Project")
			}
			return models.Workspace{}, ErrSchemaPreviewStale
		}
	} else {
		if preview.MigrationFromVersion != 0 || preview.MigrationToVersion != 0 || preview.MigrationCandidateDigest != "" ||
			len(preview.MigrationChangedPaths) != 0 || preview.RecoveryCopyPath != "" || preview.RecoverySchemaCopyPath != "" {
			return models.Workspace{}, ErrSchemaPreviewStale
		}
		if _, err := a.settings.ValidateValuesAgainstSchemaDocument(a.context(), workspace.Project.RootPath, service.SettingsPath, service.SettingsSchemaPath, schema, []byte(patchJSON)); err != nil {
			return models.Workspace{}, err
		}
		written, writeErr := a.files.WriteFileIfDigest(a.context(), workspace.Project.RootPath, service.SettingsSchemaPath, preview.PreviousSchemaDigest, schema)
		if writeErr != nil {
			return models.Workspace{}, writeErr
		}
		if !written {
			return models.Workspace{}, ErrSchemaPreviewStale
		}
	}
	return a.workspace.OpenByID(a.context(), projectID)
}

func validSettingsDigest(value string) bool {
	if len(value) != len("sha256:")+64 || !strings.HasPrefix(value, "sha256:") {
		return false
	}
	for _, char := range value[len("sha256:"):] {
		if (char < '0' || char > '9') && (char < 'a' || char > 'f') {
			return false
		}
	}
	return true
}

func settingsMigrationRecoveryPath(service models.RuntimeService, settingsDigest string) string {
	if !validSecretServiceID(service.ID) || !validSettingsDigest(settingsDigest) || service.SettingsPath == "" {
		return ""
	}
	return filepath.ToSlash(filepath.Join(filepath.Dir(service.SettingsPath), "."+service.ID+"-settings-recovery-"+strings.TrimPrefix(settingsDigest, "sha256:")+".bak"))
}

func settingsMigrationSchemaRecoveryPath(service models.RuntimeService, settingsDigest string) string {
	if !validSecretServiceID(service.ID) || !validSettingsDigest(settingsDigest) || service.SettingsSchemaPath == "" {
		return ""
	}
	return filepath.ToSlash(filepath.Join(filepath.Dir(service.SettingsSchemaPath), "."+service.ID+"-schema-recovery-"+strings.TrimPrefix(settingsDigest, "sha256:")+".bak"))
}

func writeSettingsMigrationRecoveryCopies(a *App, root string, service models.RuntimeService, settingsDigest string, settingsDocument, schemaDocument []byte) error {
	settingsPath := settingsMigrationRecoveryPath(service, settingsDigest)
	schemaPath := settingsMigrationSchemaRecoveryPath(service, settingsDigest)
	if a == nil || a.files == nil || settingsPath == "" || schemaPath == "" {
		return errors.New("project recovery copy could not be prepared")
	}
	if err := createRecoveryCopy(a, root, settingsPath, settingsDocument); err != nil {
		return errors.New("project settings recovery copy could not be created")
	}
	if err := createRecoveryCopy(a, root, schemaPath, schemaDocument); err != nil {
		return errors.New("project schema recovery copy could not be created")
	}
	return nil
}

func createRecoveryCopy(a *App, root, path string, contents []byte) error {
	err := a.files.CreateFile(a.context(), root, path, contents)
	if err == nil {
		return nil
	}
	if !errors.Is(err, os.ErrExist) {
		return err
	}
	existing, readErr := a.files.ReadFile(a.context(), root, path)
	if readErr != nil || string(existing) != string(contents) {
		return errors.New("project recovery path is occupied by different content")
	}
	return nil
}

// CreateServiceSettingsRecoveryCopy preserves the exact canonical settings
// bytes reviewed by a plugin migration preview. Only a project-relative backup
// path and digest cross the Wails boundary; file contents remain host-owned.
func (a *App) CreateServiceSettingsRecoveryCopy(projectID, serviceID, expectedDigest string) (models.ProjectSettingsRecoveryCopy, error) {
	workspace, service, err := a.settingsService(projectID, serviceID)
	if err != nil || a.files == nil || !validSettingsDigest(expectedDigest) {
		return models.ProjectSettingsRecoveryCopy{}, models.ErrInvalidProject
	}
	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()
	settingsDocument, readErr := a.files.ReadFile(a.context(), workspace.Project.RootPath, service.SettingsPath)
	if readErr != nil && !errors.Is(readErr, os.ErrNotExist) {
		return models.ProjectSettingsRecoveryCopy{}, readErr
	}
	if errors.Is(readErr, os.ErrNotExist) {
		settingsDocument = nil
	}
	actualDigest := fmt.Sprintf("sha256:%x", sha256.Sum256(settingsDocument))
	if actualDigest != expectedDigest {
		return models.ProjectSettingsRecoveryCopy{}, ErrSchemaPreviewStale
	}
	path := settingsMigrationRecoveryPath(service, expectedDigest)
	if path == "" {
		return models.ProjectSettingsRecoveryCopy{}, models.ErrInvalidProject
	}
	if err := createRecoveryCopy(a, workspace.Project.RootPath, path, settingsDocument); err != nil {
		return models.ProjectSettingsRecoveryCopy{}, errors.New("project settings recovery copy could not be created")
	}
	return models.ProjectSettingsRecoveryCopy{Path: path, Digest: actualDigest}, nil
}

func (a *App) WriteProjectSettings(projectID, serviceID, expectedDigest string, patch []byte) error {
	workspace, service, err := a.settingsService(projectID, serviceID)
	if err != nil {
		return err
	}
	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()
	if a.desktop == nil {
		return models.ErrInvalidProject
	}
	if err = a.settings.UpdateIfDigest(a.context(), workspace.Project.RootPath, service.SettingsPath, service.SettingsSchemaPath, expectedDigest, patch); err != nil {
		return err
	}
	return a.desktop.DeleteServiceSettingsDraft(a.context(), workspace.Project.ID, service.ID)
}

// WriteProjectCandidateSettings stores a safely schema-scoped Project
// candidate even when required fields are incomplete. The service/Core remains
// responsible for rejecting it at apply time; this method never applies it.
func (a *App) WriteProjectCandidateSettings(projectID, serviceID, expectedDigest string, patch []byte) error {
	workspace, service, err := a.settingsService(projectID, serviceID)
	if err != nil {
		return err
	}
	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()
	if a.desktop == nil {
		return models.ErrInvalidProject
	}
	if err = a.settings.UpdateProjectCandidateIfDigest(a.context(), workspace.Project.RootPath, service.SettingsPath, service.SettingsSchemaPath, expectedDigest, patch); err != nil {
		return err
	}
	return a.desktop.DeleteServiceSettingsDraft(a.context(), workspace.Project.ID, service.ID)
}

func (a *App) ReadServiceSettingsDraft(projectID, serviceID string) (string, error) {
	workspace, service, err := a.settingsService(projectID, serviceID)
	if err != nil {
		return "", err
	}
	if a.desktop == nil {
		return "", models.ErrInvalidProject
	}
	draft, exists, err := a.desktop.ReadServiceSettingsDraft(a.context(), workspace.Project.ID, service.ID)
	if err != nil || !exists {
		return "", err
	}
	if draft.SettingsPath != service.SettingsPath || draft.SchemaPath != service.SettingsSchemaPath {
		return "", models.ErrInvalidSettingsDraft
	}
	if validationErr := a.settings.ValidatePatch(a.context(), workspace.Project.RootPath, service.SettingsPath, service.SettingsSchemaPath, []byte(draft.PatchJSON)); validationErr != nil {
		return "", models.ErrInvalidSettingsDraft
	}
	encoded, err := json.Marshal(draft)
	return string(encoded), err
}

func (a *App) SaveServiceSettingsDraft(projectID, serviceID, baseDigest, patchJSON string) error {
	workspace, service, err := a.settingsService(projectID, serviceID)
	if err != nil {
		return err
	}
	if a.desktop == nil {
		return models.ErrInvalidProject
	}
	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()
	draft := models.ServiceSettingsDraft{ServiceID: service.ID, SettingsPath: service.SettingsPath, SchemaPath: service.SettingsSchemaPath, BaseDigest: baseDigest, PatchJSON: patchJSON}
	if err = models.ValidateServiceSettingsDraft(draft); err != nil {
		return err
	}
	if err = a.settings.ValidatePatch(a.context(), workspace.Project.RootPath, service.SettingsPath, service.SettingsSchemaPath, []byte(patchJSON)); err != nil {
		return err
	}
	return a.desktop.SaveServiceSettingsDraft(a.context(), workspace.Project.ID, draft)
}

func (a *App) DeleteServiceSettingsDraft(projectID, serviceID string) error {
	workspace, service, err := a.settingsService(projectID, serviceID)
	if err != nil {
		return err
	}
	if a.desktop == nil {
		return models.ErrInvalidProject
	}
	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()
	return a.desktop.DeleteServiceSettingsDraft(a.context(), workspace.Project.ID, service.ID)
}

func (a *App) settingsService(projectID, serviceID string) (models.Workspace, models.RuntimeService, error) {
	if a.workspace == nil || strings.TrimSpace(projectID) == "" || a.settings == nil || strings.TrimSpace(serviceID) == "" {
		return models.Workspace{}, models.RuntimeService{}, models.ErrInvalidProject
	}
	workspace, err := a.workspace.OpenByID(a.context(), projectID)
	if err != nil {
		return models.Workspace{}, models.RuntimeService{}, err
	}
	if workspace.Project == nil || workspace.Project.ID != projectID {
		return models.Workspace{}, models.RuntimeService{}, models.ErrInvalidProject
	}
	for _, service := range workspace.Graph.Services {
		if service.ID == serviceID && service.SettingsPath != "" && service.SettingsSchemaPath != "" {
			return workspace, service, nil
		}
	}
	return models.Workspace{}, models.RuntimeService{}, models.ErrInvalidProject
}

// RunStudioCommand converts a reviewed intent into a project-scoped CLI call.
// Credentials and Core transport remain owned by liapoldus.
func (a *App) RunStudioCommand(command, target, operationID, profilePath string) error {
	args, err := a.planStudioCommand(command, target, operationID, profilePath)
	if err != nil {
		return err
	}
	return a.runCLIArgs(args)
}

// RunStudioCommandAndWait keeps transactional workflows serialized through
// process completion while CLI events continue to stream to the renderer.
func (a *App) RunStudioCommandAndWait(command, target, operationID, profilePath string) error {
	args, err := a.planStudioCommand(command, target, operationID, profilePath)
	if err != nil {
		return err
	}
	return a.runCLIArgsAndWait(args)
}

// ReadCoreSettings returns only the CLI-redacted settings view for the local
// target. The renderer never receives the Core client, credentials, or raw
// settings document.
func (a *App) ReadCoreSettings() (string, error) {
	workspace, err := a.workspace.Current(a.context())
	if err != nil || workspace.Project == nil || a.cli == nil {
		return "", models.ErrInvalidProject
	}
	value, err := a.runCLIJSONSerialized(workspace, models.CLIIntent{Command: "core.settings.inspect", Target: "local"}, 20*time.Second)
	if err != nil {
		return "", err
	}
	var view models.CoreSettingsView
	err = json.Unmarshal(value, &view)
	if err != nil || view.SchemaVersion != "core-settings-view/v1" || view.Target != "local" || view.DesiredRevision == 0 {
		return "", errors.New("liapoldus returned an invalid Core settings view")
	}
	encoded, err := json.Marshal(view)
	if err != nil {
		return "", errors.New("core settings view could not be encoded")
	}
	return string(encoded), nil
}

// UpdateCoreSettings writes a short-lived, mode-0600 typed patch file for the
// CLI. No arbitrary file path, raw CLI argument, secret, or Core JSON document
// crosses the Wails boundary.
func (a *App) UpdateCoreSettings(expectedRevision uint64, maxBodyBytes int64, headerTimeout, requestTimeout string) (string, error) {
	if err := validateCoreSettingsPatch(expectedRevision, maxBodyBytes, headerTimeout, requestTimeout); err != nil {
		return "", err
	}
	workspace, err := a.workspace.Current(a.context())
	if err != nil || workspace.Project == nil || a.cli == nil {
		return "", models.ErrInvalidProject
	}
	//nolint:govet // Preserve the core-settings-patch/v1 field layout.
	request := struct {
		SchemaVersion string `json:"schemaVersion"`
		Management    struct {
			MaxBodyBytes   *int64  `json:"maxBodyBytes,omitempty"`
			HeaderTimeout  *string `json:"headerTimeout,omitempty"`
			RequestTimeout *string `json:"requestTimeout,omitempty"`
		} `json:"management"`
		ExpectedRevision uint64   `json:"expectedRevision"`
		ServiceControl   struct{} `json:"serviceControl"`
	}{ExpectedRevision: expectedRevision, SchemaVersion: "core-settings-patch/v1", ServiceControl: struct{}{}}
	request.Management.MaxBodyBytes = &maxBodyBytes
	request.Management.HeaderTimeout = &headerTimeout
	request.Management.RequestTimeout = &requestTimeout
	body, err := json.Marshal(request)
	if err != nil {
		return "", errors.New("core settings patch could not be encoded")
	}
	tempDir, err := os.MkdirTemp("", "liapoldus-studio-core-settings-")
	if err != nil {
		return "", errors.New("temporary Core settings request directory is unavailable")
	}
	defer func() {
		if cleanupErr := os.RemoveAll(tempDir); cleanupErr != nil {
			a.recordDiagnosticContext(a.context(), workspace.Project.RootPath, models.Diagnostic{Owner: "studio", Code: "core.settings.temp_cleanup", Severity: "warning", Message: "temporary Core settings request could not be removed"})
		}
	}()
	requestPath := filepath.Join(tempDir, "patch.json")
	err = os.WriteFile(requestPath, body, 0o600)
	if err != nil {
		return "", errors.New("temporary Core settings patch could not be written")
	}
	value, err := a.runCLIJSONSerialized(workspace, models.CLIIntent{Command: "core.settings.update", Target: "local", RequestFilePath: requestPath}, 30*time.Second)
	if err != nil {
		return "", err
	}
	var result struct {
		SchemaVersion string                  `json:"schemaVersion"`
		Target        string                  `json:"target"`
		Result        models.CoreSettingsView `json:"result"`
	}
	err = json.Unmarshal(value, &result)
	if err != nil || result.SchemaVersion != "core-settings-update-result/v1" || result.Target != "local" || result.Result.Target != "local" {
		return "", errors.New("liapoldus returned an invalid Core settings update result")
	}
	encoded, err := json.Marshal(result.Result)
	if err != nil {
		return "", errors.New("core settings update result could not be encoded")
	}
	return string(encoded), nil
}

func validateCoreSettingsPatch(expectedRevision uint64, maxBodyBytes int64, headerTimeout, requestTimeout string) error {
	if expectedRevision == 0 {
		return errors.New("core settings patch requires a current revision")
	}
	if maxBodyBytes < 1 || maxBodyBytes > 16<<20 {
		return errors.New("management.maxBodyBytes must be between 1 and 16777216")
	}
	for _, value := range []string{headerTimeout, requestTimeout} {
		parsed, err := time.ParseDuration(strings.TrimSpace(value))
		if err != nil || parsed <= 0 || strings.ContainsAny(value, "\x00\r\n") {
			return errors.New("core timeout values must be positive Go duration strings")
		}
	}
	return nil
}

func (a *App) runCLIJSONSerialized(workspace models.Workspace, intent models.CLIIntent, timeout time.Duration) (json.RawMessage, error) {
	if workspace.Project == nil || a.cli == nil {
		return nil, models.ErrInvalidProject
	}
	args, err := cliplan.Plan(intent, workspace.Project.RootPath)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(a.context(), timeout)
	a.cliMu.Lock()
	if a.cliCancel != nil {
		a.cliMu.Unlock()
		cancel()
		return nil, ErrCLICommandRunning
	}
	a.cliGeneration++
	generation := a.cliGeneration
	a.cliCancel = cancel
	a.cliRunID = ""
	a.cliMu.Unlock()
	defer func() {
		a.clearCLICancel(generation)
		cancel()
	}()
	events, err := a.cli.Run(ctx, models.CLIRequest{ProjectRoot: workspace.Project.RootPath, WorkingDir: workspace.Project.RootPath, Args: args})
	if err != nil {
		return nil, err
	}
	var payload json.RawMessage
	var failure, diagnostic string
	terminal := false
	for event := range events {
		if event.Type == "run.started" {
			a.cliMu.Lock()
			if a.cliGeneration == generation && !strings.HasPrefix(a.cliRunID, cliCancelRunIDPrefix) {
				a.cliRunID = event.RunID
			}
			a.cliMu.Unlock()
		}
		if event.Type == "run.output" && len(event.Payload) > 0 {
			payload = append(json.RawMessage(nil), event.Payload...)
		}
		if event.Type == "diagnostic" && (event.Severity == "error" || event.Severity == "warning") {
			diagnostic = strings.Trim(strings.Join([]string{safeCLIText(event.Code), safeCLIText(event.Message)}, ": "), ": ")
			a.recordDiagnosticContext(ctx, workspace.Project.RootPath, models.Diagnostic{Owner: "cli", Code: safeCLIText(event.Code), Severity: event.Severity, Message: safeCLIText(event.Message), OperationID: event.OperationID, Target: event.Target})
		}
		if event.Type == "run.completed" {
			terminal = true
		}
		if event.Type == "run.failed" {
			terminal = true
			failure = strings.Trim(strings.Join([]string{safeCLIText(event.Code), safeCLIText(event.Message)}, ": "), ": ")
			if diagnostic != "" {
				failure = diagnostic
			}
		}
		a.emitCLIEvent(event)
	}
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if failure != "" {
		return nil, errors.New(failure)
	}
	if !terminal || len(payload) == 0 {
		return nil, errors.New("liapoldus event stream ended without a structured result")
	}
	return safeCLIJSON(payload)
}

func (a *App) planStudioCommand(command, target, operationID, profilePath string) ([]string, error) {
	workspace, err := a.workspace.Current(a.context())
	if err != nil {
		return nil, err
	}
	if workspace.Project == nil || a.cli == nil {
		return nil, models.ErrInvalidProject
	}
	args, err := cliplan.Plan(models.CLIIntent{Command: command, Target: target, OperationID: operationID, ProfilePath: profilePath}, workspace.Project.RootPath)
	if err != nil {
		return nil, err
	}
	return args, nil
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
	// Runtime lifecycle calls must hold the one-process CLI slot until a terminal
	// event. Studio refreshes Core metadata immediately afterward; returning after
	// merely spawning the CLI races those reads against the still-running process.
	return a.runCLIArgsAndWait(args)
}

func (a *App) ListRuntimeArtifacts() ([]models.ArtifactReference, error) {
	value, err := a.runCLIJSON(models.CLIIntent{Command: "service.artifact.list"})
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
	value, err := a.runCLIJSON(models.CLIIntent{Command: "service.artifact.register", ArtifactID: id, Version: version, Platform: platform, BinaryPath: binaryPath})
	if err != nil {
		return models.ArtifactReference{}, err
	}
	var artifact models.ArtifactReference
	if err := json.Unmarshal(value, &artifact); err != nil {
		return models.ArtifactReference{}, err
	}
	return artifact, nil
}

// InspectCoreBinary asks the selected CLI to validate an already-built Linux
// Core binary. Only digest/platform/size cross back to the renderer; the path
// remains a user-selected input to the typed host boundary.
func (a *App) InspectCoreBinary(binaryPath string) (string, error) {
	if !filepath.IsAbs(binaryPath) || strings.ContainsAny(binaryPath, "\x00\r\n") {
		return "", models.ErrInvalidProject
	}
	value, err := a.runCLIJSON(models.CLIIntent{Command: "core.binary.inspect", BinaryPath: filepath.Clean(binaryPath)})
	if err != nil {
		return "", err
	}
	var inspection struct {
		Digest    string `json:"digest"`
		Platform  string `json:"platform"`
		SizeBytes int64  `json:"sizeBytes"`
	}
	if err := json.Unmarshal(value, &inspection); err != nil || inspection.Digest == "" || inspection.Platform == "" || inspection.SizeBytes <= 0 {
		return "", errors.New("CLI returned invalid Core binary inspection")
	}
	return string(value), nil
}

// UpdateLocalCoreBinary asks the CLI to perform the reviewed update as one
// operation. The CLI starts the candidate before committing it to the target
// registry, so a failed start cannot leave the target pointed at a bad binary.
func (a *App) UpdateLocalCoreBinary(binaryPath, digest string, confirmed bool) (string, error) {
	if !confirmed || !filepath.IsAbs(binaryPath) || strings.TrimSpace(digest) == "" || strings.ContainsAny(binaryPath+digest, "\x00\r\n") {
		return "", models.ErrInvalidProject
	}
	inspection, err := a.InspectCoreBinary(binaryPath)
	if err != nil {
		return "", err
	}
	var metadata struct {
		Digest   string `json:"digest"`
		Platform string `json:"platform"`
	}
	if decodeErr := json.Unmarshal([]byte(inspection), &metadata); decodeErr != nil || metadata.Digest != digest {
		return "", errors.New("selected Core binary changed after digest review")
	}
	value, err := a.runCLIJSON(models.CLIIntent{Command: "core.binary.update", Target: "local", BinaryPath: filepath.Clean(binaryPath), Digest: digest})
	if err != nil {
		return "", err
	}
	var update struct {
		Digest     string `json:"digest"`
		Platform   string `json:"platform"`
		Target     string `json:"target"`
		Configured bool   `json:"configured"`
		Running    bool   `json:"running"`
	}
	if err := json.Unmarshal(value, &update); err != nil || !update.Configured || !update.Running || update.Target != "local" || update.Digest != digest || update.Platform != metadata.Platform {
		return "", errors.New("CLI did not confirm that the reviewed Core binary is configured and running")
	}
	return string(value), nil
}

func (a *App) TrustRuntimeArtifact(id, version, platform, digest string) (models.ArtifactReference, error) {
	value, err := a.runCLIJSON(models.CLIIntent{Command: "service.artifact.trust", ArtifactID: id, Version: version, Platform: platform, Digest: digest})
	if err != nil {
		return models.ArtifactReference{}, err
	}
	var artifact models.ArtifactReference
	if err := json.Unmarshal(value, &artifact); err != nil {
		return models.ArtifactReference{}, err
	}
	return artifact, nil
}

// RemoveRuntimeArtifact removes only the exact artifact digest reviewed in
// the UI. The CLI remains the owner of registry paths and trust metadata.
func (a *App) RemoveRuntimeArtifact(id, version, platform, digest string, confirmed bool) error {
	if !confirmed || a.cli == nil || strings.TrimSpace(digest) == "" {
		return models.ErrInvalidProject
	}
	intent := models.CLIIntent{Command: "service.artifact.inspect", ArtifactID: id, Version: version, Platform: platform}
	value, err := a.runCLIJSON(intent)
	if err != nil {
		return err
	}
	var artifact models.ArtifactReference
	if unmarshalErr := json.Unmarshal(value, &artifact); unmarshalErr != nil {
		return unmarshalErr
	}
	if artifact.ID != id || artifact.Version != version || artifact.Platform != platform || artifact.Digest != digest {
		return errors.New("artifact changed since it was selected; refresh the registry before removing it")
	}
	_, err = a.runCLIJSON(models.CLIIntent{Command: "service.artifact.remove", ArtifactID: id, Version: version, Platform: platform})
	return err
}

// BindRuntimeServiceArtifact resolves the selected artifact in the CLI-owned
// registry, verifies its current trust and digest, then stores only its
// immutable identity in the canonical Project service manifest.
func (a *App) BindRuntimeServiceArtifact(projectID, serviceID, version, platform string) (models.Workspace, error) {
	if a.workspace == nil || a.cli == nil || a.graph == nil || strings.TrimSpace(projectID) == "" || strings.TrimSpace(serviceID) == "" {
		return models.Workspace{}, models.ErrInvalidProject
	}
	workspace, err := a.workspace.OpenByID(a.context(), projectID)
	if err != nil || workspace.Project == nil || workspace.Project.ID != projectID {
		return models.Workspace{}, models.ErrInvalidProject
	}
	serviceFound := false
	for _, service := range workspace.Graph.Services {
		if service.ID == serviceID {
			serviceFound = true
			break
		}
	}
	if !serviceFound {
		return models.Workspace{}, models.ErrInvalidProject
	}
	value, err := a.runCLIJSONInWorkspace(workspace, models.CLIIntent{
		Command: "service.artifact.inspect", ArtifactID: serviceID, Version: version, Platform: platform,
	})
	if err != nil {
		return models.Workspace{}, err
	}
	var artifact models.ArtifactReference
	if err := json.Unmarshal(value, &artifact); err != nil {
		return models.Workspace{}, err
	}
	if !artifact.Trusted || artifact.ID != serviceID || artifact.Version != version || artifact.Platform != platform {
		return models.Workspace{}, errors.New("service artifact must match the selected service and be explicitly trusted in the CLI registry")
	}
	if err := a.graph.SetRuntimeServiceArtifact(a.context(), workspace.Project.RootPath, serviceID, models.ServiceArtifactInput{
		ID: artifact.ID, Version: artifact.Version, Platform: artifact.Platform, Digest: artifact.Digest,
	}); err != nil {
		return models.Workspace{}, err
	}
	return a.workspace.OpenByID(a.context(), projectID)
}

// ReadRuntimeServiceMetadata is Core-backed. liapoldus asks Core for the view;
// Studio does not call Service SDK REST endpoints directly. The project ID is
// explicit so a delayed metadata request cannot be redirected after workspace
// switching.
func (a *App) ReadRuntimeServiceMetadata(projectID, serviceID, view string) (string, error) {
	if view != "manifest" && view != "schema" && view != "status" {
		return "", models.ErrInvalidProject
	}
	if a.workspace == nil || a.cli == nil || strings.TrimSpace(serviceID) == "" {
		return "", models.ErrInvalidProject
	}
	workspace, err := a.workspace.OpenByID(a.context(), projectID)
	if err != nil {
		return "", err
	}
	found := false
	for _, service := range workspace.Graph.Services {
		if service.ID == serviceID {
			found = true
			break
		}
	}
	if !found {
		return "", models.ErrInvalidProject
	}
	value, err := a.runCLIJSONInWorkspaceWithTimeout(workspace, models.CLIIntent{Command: "service." + view, Target: "local", ServiceID: serviceID}, 12*time.Second)
	if err != nil {
		return "", err
	}
	return string(value), nil
}

// ReadRuntimeServiceAdminSurface returns Core-owned action descriptors through
// the typed CLI boundary. Studio and CLI never contact Service SDK REST APIs.
func (a *App) ReadRuntimeServiceAdminSurface(projectID, serviceID string) (string, error) {
	if a.workspace == nil || a.cli == nil || strings.TrimSpace(serviceID) == "" {
		return "", models.ErrInvalidProject
	}
	workspace, err := a.workspace.OpenByID(a.context(), projectID)
	if err != nil {
		return "", err
	}
	found := false
	for _, service := range workspace.Graph.Services {
		if service.ID == serviceID {
			found = true
			break
		}
	}
	if !found {
		return "", models.ErrInvalidProject
	}
	value, err := a.runCLIJSONInWorkspaceWithTimeout(workspace, models.CLIIntent{
		Command: "service.admin-surface.inspect", Target: "local", ServiceID: serviceID,
	}, 12*time.Second)
	if err != nil {
		return "", err
	}
	if len(value) == 0 || len(value) > 1<<20 || !json.Valid(value) {
		return "", errors.New("core returned an invalid or oversized service admin surface")
	}
	return string(value), nil
}

// SelectRuntimeServiceResourceArtifact returns only a project-relative file
// reference. The selected file must already be present in the canonical
// Project file index; absolute paths never cross into a StudioPlugin frame.
func (a *App) SelectRuntimeServiceResourceArtifact(projectID, serviceID string) (string, error) {
	if a.ctx == nil || a.workspace == nil || a.files == nil {
		return "", models.ErrInvalidProject
	}
	workspace, err := a.workspace.OpenByID(a.context(), projectID)
	if err != nil || workspace.Project == nil || workspace.Project.ID != projectID || !workspaceHasService(workspace, serviceID) {
		return "", models.ErrInvalidProject
	}
	selected, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{Title: "Choose artifact to import into Project", Filters: []runtime.FileFilter{{DisplayName: "Gzip archive", Pattern: "*.tar.gz;*.tgz"}}})
	if err != nil || selected == "" {
		return "", err
	}
	selected = filepath.Clean(selected)
	if sensitiveResourceExtension(selected) {
		return "", errInvalidProjectResource
	}
	if relative, relErr := filepath.Rel(workspace.Project.RootPath, selected); relErr == nil && !filepath.IsAbs(relative) && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		if safeProjectResourceFile(workspace, filepath.ToSlash(relative)) {
			return filepath.ToSlash(relative), nil
		}
		return "", errInvalidProjectResource
	}
	return importProjectResourceArtifact(a.context(), a.files, workspace.Project.RootPath, selected)
}

// SelectRuntimeServiceProjectDirectory packages a directory under the
// Project root using the generic Studio artifact pipeline. The plugin only
// receives the resulting Project-relative archive path.
func (a *App) SelectRuntimeServiceProjectDirectory(projectID, serviceID string) (artifactPath string, returnErr error) {
	if a.ctx == nil || a.workspace == nil || a.files == nil {
		return "", models.ErrInvalidProject
	}
	workspace, err := a.workspace.OpenByID(a.context(), projectID)
	if err != nil || workspace.Project == nil || workspace.Project.ID != projectID || !workspaceHasService(workspace, serviceID) {
		return "", models.ErrInvalidProject
	}
	selected, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{Title: "Choose a Project directory to package"})
	if err != nil || selected == "" {
		return "", err
	}
	selected, err = filepath.Abs(filepath.Clean(selected))
	if err != nil {
		return "", errInvalidProjectResource
	}
	relative, err := filepath.Rel(workspace.Project.RootPath, selected)
	if err != nil || !filepath.IsLocal(relative) || relative == "." {
		return "", errInvalidProjectResource
	}
	temporaryArchive, err := packageProjectDirectory(selected)
	if err != nil {
		return "", err
	}
	defer func() {
		if cleanupErr := os.Remove(temporaryArchive); cleanupErr != nil && !errors.Is(cleanupErr, os.ErrNotExist) {
			returnErr = errors.Join(returnErr, fmt.Errorf("%w: temporary archive cleanup failed", errInvalidProjectResource), cleanupErr)
		}
	}()
	return importProjectResourceArtifact(a.context(), a.files, workspace.Project.RootPath, temporaryArchive)
}

// ImportRuntimeServiceProjectCertificate imports a public certificate only
// when the live service manifest declares the matching Project certificate
// catalog. The renderer receives a Project-relative reference, never the
// selected external path or certificate bytes.
func (a *App) ImportRuntimeServiceProjectCertificate(projectID, serviceID, resourceID string) (string, error) {
	if a.ctx == nil || a.workspace == nil || a.cli == nil || a.files == nil || strings.TrimSpace(serviceID) == "" || strings.TrimSpace(resourceID) == "" {
		return "", models.ErrInvalidProject
	}
	workspace, err := a.workspace.OpenByID(a.context(), projectID)
	if err != nil || workspace.Project == nil || workspace.Project.ID != projectID || !workspaceHasService(workspace, serviceID) {
		return "", models.ErrInvalidProject
	}
	manifest, err := a.runCLIJSONInWorkspaceWithTimeout(workspace, models.CLIIntent{
		Command: "service.manifest", Target: "local", ServiceID: serviceID,
	}, 12*time.Second)
	if err != nil {
		return "", err
	}
	descriptor, err := findProjectResourceDescriptor(manifest, resourceID)
	if err != nil || descriptor.Provider != "project" || descriptor.Kind != "certificate" {
		return "", errInvalidProjectResource
	}
	selected, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   "Import public certificate into Project",
		Filters: []runtime.FileFilter{{DisplayName: "Public certificate", Pattern: "*.pem;*.crt;*.cer;*.der"}},
	})
	if err != nil || selected == "" {
		return "", err
	}
	selected = filepath.Clean(selected)
	if relative, relErr := filepath.Rel(workspace.Project.RootPath, selected); relErr == nil && !filepath.IsAbs(relative) && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		relative = filepath.ToSlash(relative)
		if !safeProjectResourceFile(workspace, relative) || !certificateExtension(relative) {
			return "", errInvalidProjectResource
		}
		contents, readErr := a.files.ReadFile(a.context(), workspace.Project.RootPath, relative)
		if readErr != nil || len(contents) == 0 || len(contents) > projectCertificateMaxBytes || !containsPublicCertificate(contents) {
			return "", errInvalidProjectResource
		}
		return relative, nil
	}
	return importProjectCertificate(a.context(), a.files, workspace.Project.RootPath, selected)
}

// PublishRuntimeServiceResourceJSON validates the selected artifact against
// the current Core-owned action descriptor, asks for native confirmation,
// stages metadata privately under .studio, and delegates the operation to the
// typed CLI. The temporary metadata file is removed on every exit path.
func (a *App) PublishRuntimeServiceResourceJSON(projectID, serviceID, pageID, actionID, artifactPath, contentType, metadataJSON, ifMatch string) (string, error) {
	return a.publishRuntimeServiceResourceJSON(projectID, serviceID, pageID, actionID, artifactPath, contentType, metadataJSON, ifMatch, func(ctx context.Context, title, message string) (bool, error) {
		result, err := runtime.MessageDialog(ctx, runtime.MessageDialogOptions{Type: runtime.QuestionDialog, Title: title, Message: message, Buttons: []string{"Отмена", "Продолжить"}, DefaultButton: "Отмена", CancelButton: "Отмена"})
		return result == "Продолжить", err
	})
}

func (a *App) publishRuntimeServiceResourceJSON(projectID, serviceID, pageID, actionID, artifactPath, contentType, metadataJSON, ifMatch string, confirm func(context.Context, string, string) (bool, error)) (result string, resultErr error) {
	if a.workspace == nil || a.cli == nil || a.files == nil || confirm == nil {
		return "", models.ErrInvalidProject
	}
	workspace, err := a.workspace.OpenByID(a.context(), projectID)
	if err != nil || workspace.Project == nil || workspace.Project.ID != projectID || !workspaceHasService(workspace, serviceID) || !safeProjectResourceFile(workspace, artifactPath) || sensitiveResourceExtension(artifactPath) {
		return "", errInvalidProjectResource
	}
	metadata := []byte(metadataJSON)
	if !safeServiceActionMetadata(metadata) {
		return "", errInvalidProjectResource
	}
	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil || mediaType == "" || !safeProjectResourceID(pageID) || !safeProjectResourceID(actionID) {
		return "", errInvalidProjectResource
	}
	encodedSurface, err := a.runCLIJSONInWorkspaceWithTimeout(workspace, models.CLIIntent{Command: "service.admin-surface.inspect", Target: "local", ServiceID: serviceID}, 12*time.Second)
	if err != nil {
		return "", err
	}
	confirmation, maxArtifactBytes, maxMetadataBytes, mediaAllowed, err := serviceArtifactAction(encodedSurface, serviceID, pageID, actionID, mediaType)
	if err != nil || confirmation == "" {
		return "", errInvalidProjectResource
	}
	if !mediaAllowed || len(metadata) == 0 || int64(len(metadata)) > maxMetadataBytes || workspaceFileBytes(workspace, artifactPath) < 0 || workspaceFileBytes(workspace, artifactPath) > maxArtifactBytes {
		return "", errInvalidProjectResource
	}
	stagedArtifactPath, artifactBytes, artifactDigest, cleanupArtifact, err := stageServiceArtifactSnapshot(workspace.Project.RootPath, artifactPath, maxArtifactBytes)
	if err != nil {
		return "", err
	}
	defer func() {
		if cleanupErr := cleanupArtifact(); cleanupErr != nil {
			resultErr = errors.Join(resultErr, cleanupErr)
		}
	}()
	confirmation = fmt.Sprintf("%s\n\nProject file: %s\nBytes: %d\nSHA-256: %s", confirmation, filepath.Base(filepath.FromSlash(artifactPath)), artifactBytes, artifactDigest)
	confirmed, err := confirm(a.context(), "Confirm service action", confirmation)
	if err != nil {
		return "", err
	}
	if !confirmed {
		return "", errors.New("service action cancelled")
	}
	metadataPath, cleanup, err := stageServiceActionMetadata(workspace.Project.RootPath, metadata)
	if err != nil {
		return "", err
	}
	defer func() {
		if cleanupErr := cleanup(); cleanupErr != nil {
			resultErr = errors.Join(resultErr, cleanupErr)
		}
	}()
	var keyBytes [16]byte
	if _, randomErr := rand.Read(keyBytes[:]); randomErr != nil {
		return "", randomErr
	}
	value, err := a.runCLIJSONInWorkspaceWithTimeout(workspace, models.CLIIntent{
		Command: "service.resource.publish", Target: "local", ServiceID: serviceID,
		PageID: pageID, ActionID: actionID, ArtifactPath: stagedArtifactPath, ContentType: mediaType,
		MetadataPath: metadataPath, IfMatch: ifMatch, IdempotencyKey: "studio-publish-" + hex.EncodeToString(keyBytes[:]),
	}, 2*time.Minute)
	if err != nil {
		return "", err
	}
	return string(value), nil
}

func workspaceHasService(workspace models.Workspace, serviceID string) bool {
	for _, service := range workspace.Graph.Services {
		if service.ID == serviceID {
			return true
		}
	}
	return false
}

func workspaceFileBytes(workspace models.Workspace, relative string) int64 {
	for _, file := range workspace.Files {
		if file.Path == relative && file.Kind == "file" {
			return file.Bytes
		}
	}
	return -1
}

// ReadRuntimeServiceResource first authorizes a catalog from the live manifest
// via typed CLI → Core. Service-admin catalogs stay on that path; Project
// catalogs are resolved from Studio's safe, project-scoped file index. Studio
// never calls a service endpoint.
func (a *App) ReadRuntimeServiceResource(projectID, serviceID, resourceID string) (string, error) {
	if a.workspace == nil || a.cli == nil || strings.TrimSpace(serviceID) == "" || strings.TrimSpace(resourceID) == "" {
		return "", models.ErrInvalidProject
	}
	workspace, err := a.workspace.OpenByID(a.context(), projectID)
	if err != nil {
		return "", err
	}
	found := false
	for _, service := range workspace.Graph.Services {
		if service.ID == serviceID {
			found = true
			break
		}
	}
	if !found {
		return "", models.ErrInvalidProject
	}
	manifest, err := a.runCLIJSONInWorkspaceWithTimeout(workspace, models.CLIIntent{
		Command: "service.manifest", Target: "local", ServiceID: serviceID,
	}, 12*time.Second)
	if err != nil {
		return "", err
	}
	descriptor, err := findProjectResourceDescriptor(manifest, resourceID)
	if err != nil {
		return "", err
	}
	if descriptor.Provider == "project" {
		return projectResourceCatalog(a.context(), descriptor, workspace, a.files)
	}
	if descriptor.Provider != "service-admin" {
		return "", errInvalidProjectResource
	}
	value, err := a.runCLIJSONInWorkspaceWithTimeout(workspace, models.CLIIntent{
		Command: "service.resource.list", Target: "local", ServiceID: serviceID, ResourceID: resourceID,
	}, 20*time.Second)
	if err != nil {
		return "", err
	}
	return string(value), nil
}

func safeProjectResourceFile(workspace models.Workspace, relative string) bool {
	if !safeProjectResourcePath(relative) {
		return false
	}
	for _, file := range workspace.Files {
		if file.Path == relative && file.Kind == "file" && file.Bytes >= 0 {
			return true
		}
	}
	return false
}

func (a *App) runCLIJSON(intent models.CLIIntent) (json.RawMessage, error) {
	workspace, err := a.workspace.Current(a.context())
	if err != nil {
		return nil, err
	}
	if workspace.Project == nil || a.cli == nil {
		return nil, models.ErrInvalidProject
	}
	return a.runCLIJSONInWorkspace(workspace, intent)
}

func (a *App) runCLIJSONInWorkspace(workspace models.Workspace, intent models.CLIIntent) (json.RawMessage, error) {
	return a.runCLIJSONInWorkspaceWithTimeout(workspace, intent, 60*time.Second)
}

func (a *App) runCLIJSONInWorkspaceWithTimeout(workspace models.Workspace, intent models.CLIIntent, timeout time.Duration) (json.RawMessage, error) {
	if workspace.Project == nil || a.cli == nil {
		return nil, models.ErrInvalidProject
	}
	args, err := cliplan.Plan(intent, workspace.Project.RootPath)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(a.context(), timeout)
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
			if event.Severity == "error" || event.Severity == "warning" {
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
		if diagnostic != "" {
			return nil, fmt.Errorf("%s", safeCLIText("liapoldus: "+diagnostic))
		}
		return nil, fmt.Errorf("%s", safeCLIText("liapoldus: "+failure))
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
	return safeCLIJSON(payload)
}

func (a *App) runCLIArgs(args []string) error {
	_, err := a.startCLIArgs(args)
	return err
}

func (a *App) runCLIArgsAndWait(args []string) error {
	done, err := a.startCLIArgs(args)
	if err != nil {
		return err
	}
	return <-done
}

func (a *App) startCLIArgs(args []string) (<-chan error, error) {
	workspace, err := a.workspace.Current(a.context())
	if err != nil {
		return nil, err
	}
	if workspace.Project == nil || a.cli == nil {
		return nil, models.ErrInvalidProject
	}
	done := make(chan error, 1)
	runContext, cancel := context.WithCancel(a.context())
	a.cliMu.Lock()
	if a.cliCancel != nil {
		a.cliMu.Unlock()
		cancel()
		return nil, ErrCLICommandRunning
	}
	a.cliGeneration++
	generation := a.cliGeneration
	a.cliCancel = cancel
	a.cliRunID = ""
	a.cliMu.Unlock()
	events, err := a.cli.Run(runContext, models.CLIRequest{
		ProjectRoot: workspace.Project.RootPath,
		WorkingDir:  workspace.Project.RootPath,
		Args:        args,
	})
	if err != nil {
		cancel()
		a.clearCLICancel(generation)
		return nil, err
	}
	go func() {
		var commandErr error
		var diagnosticEvent models.CLIEvent
		terminal := false
		defer func() {
			contextErr := runContext.Err()
			a.clearCLICancel(generation)
			if commandErr == nil {
				if contextErr != nil {
					commandErr = contextErr
				} else if !terminal {
					commandErr = errors.New("liapoldus event stream ended without a terminal status")
				}
			}
			cancel()
			done <- commandErr
			close(done)
		}()
		for event := range events {
			if event.Type == "diagnostic" && (event.Severity == "warning" || event.Severity == "error") {
				diagnosticEvent = event
			}
			if event.Type == "run.started" {
				a.cliMu.Lock()
				if a.cliGeneration == generation && !strings.HasPrefix(a.cliRunID, cliCancelRunIDPrefix) {
					a.cliRunID = event.RunID
				}
				a.cliMu.Unlock()
			}
			if event.Type == "diagnostic" || event.Type == "run.failed" && diagnosticEvent.Type != "diagnostic" {
				a.recordDiagnosticContext(runContext, workspace.Project.RootPath, models.Diagnostic{Owner: "cli", Code: safeCLIText(event.Code), Severity: event.Severity, Message: safeCLIText(event.Message), OperationID: event.OperationID, Target: event.Target})
			}
			if event.Type == "run.completed" {
				terminal = true
			}
			if event.Type == "run.failed" {
				terminal = true
				commandErr = cliEventErrorWithDiagnostic(event, diagnosticEvent)
			}
			if event.Type == "report.available" && event.ReportPath != "" {
				if importErr := a.importReportContext(runContext, event.ReportPath); importErr != nil {
					event = models.CLIEvent{
						SchemaVersion: "cli-events/v1",
						Type:          "diagnostic",
						Severity:      "error",
						Code:          "report.import",
						Message:       "CLI report could not be imported",
					}
					a.recordDiagnosticContext(runContext, workspace.Project.RootPath, models.Diagnostic{Owner: "report", Code: "report.import", Severity: "error", Message: "CLI report could not be imported"})
				}
			}
			a.emitCLIEvent(event)
		}
	}()
	return done, nil
}

func cliEventError(event models.CLIEvent) error {
	message := strings.TrimSpace(safeCLIText(event.Message))
	code := strings.TrimSpace(safeCLIText(event.Code))
	switch {
	case code != "" && message != "":
		return fmt.Errorf("liapoldus: %s: %s", code, message)
	case code != "":
		return fmt.Errorf("liapoldus: %s", code)
	case message != "":
		return fmt.Errorf("liapoldus: %s", message)
	default:
		return errors.New("liapoldus process failed")
	}
}

func cliEventErrorWithDiagnostic(failure, diagnostic models.CLIEvent) error {
	if diagnostic.Type != "diagnostic" || (diagnostic.Severity != "warning" && diagnostic.Severity != "error") {
		return cliEventError(failure)
	}
	message := strings.TrimSpace(safeCLIText(diagnostic.Message))
	code := strings.TrimSpace(safeCLIText(diagnostic.Code))
	if message == "" && code == "" {
		return cliEventError(failure)
	}
	if code != "" && message != "" {
		return fmt.Errorf("liapoldus: %s: %s", code, message)
	}
	if code != "" {
		return fmt.Errorf("liapoldus: %s", code)
	}
	return fmt.Errorf("liapoldus: %s", message)
}

func (a *App) CreateRuntimeService(input models.RuntimeServiceInput) (models.Workspace, error) {
	workspace, err := a.workspace.Current(a.context())
	if err != nil || workspace.Project == nil || a.graph == nil {
		return models.Workspace{}, models.ErrInvalidProject
	}
	if err := a.graph.CreateRuntimeService(a.context(), workspace.Project.RootPath, input); err != nil {
		return models.Workspace{}, err
	}
	return a.workspace.Open(a.context(), workspace.Project.RootPath)
}

func (a *App) DeleteRuntimeService(id string, confirmed bool) (models.Workspace, error) {
	workspace, err := a.workspace.Current(a.context())
	if err != nil || workspace.Project == nil || a.graph == nil {
		return models.Workspace{}, models.ErrInvalidProject
	}
	if err := a.graph.DeleteRuntimeService(a.context(), workspace.Project.RootPath, id, confirmed); err != nil {
		return models.Workspace{}, err
	}
	return a.workspace.Open(a.context(), workspace.Project.RootPath)
}

func (a *App) CreateServiceLink(input models.ServiceLinkInput) (models.Workspace, error) {
	workspace, err := a.workspace.Current(a.context())
	if err != nil || workspace.Project == nil || a.graph == nil {
		return models.Workspace{}, models.ErrInvalidProject
	}
	if err := a.graph.CreateServiceLink(a.context(), workspace.Project.RootPath, input); err != nil {
		return models.Workspace{}, err
	}
	return a.workspace.Open(a.context(), workspace.Project.RootPath)
}

func (a *App) UpdateServiceLink(input models.ServiceLinkInput) (models.Workspace, error) {
	workspace, err := a.workspace.Current(a.context())
	if err != nil || workspace.Project == nil || a.graph == nil {
		return models.Workspace{}, models.ErrInvalidProject
	}
	if err := a.graph.UpdateServiceLink(a.context(), workspace.Project.RootPath, input.Caller, input.ID, input); err != nil {
		return models.Workspace{}, err
	}
	return a.workspace.Open(a.context(), workspace.Project.RootPath)
}

func (a *App) DeleteServiceLink(caller, id string, confirmed bool) (models.Workspace, error) {
	workspace, err := a.workspace.Current(a.context())
	if err != nil || workspace.Project == nil || a.graph == nil {
		return models.Workspace{}, models.ErrInvalidProject
	}
	if err := a.graph.DeleteServiceLink(a.context(), workspace.Project.RootPath, caller, id, confirmed); err != nil {
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
	a.recordDiagnosticContext(a.context(), root, diagnostic)
}

func (a *App) recordDiagnosticContext(ctx context.Context, root string, diagnostic models.Diagnostic) {
	if a.diagnostics == nil || strings.TrimSpace(diagnostic.Code) == "" {
		return
	}
	if appendErr := a.diagnostics.Append(ctx, root, diagnostic); appendErr != nil {
		return
	}
}

func (a *App) CancelCLI() {
	a.cliMu.Lock()
	cancel := a.cliCancel
	if cancel == nil || strings.HasPrefix(a.cliRunID, cliCancelRunIDPrefix) {
		a.cliMu.Unlock()
		return
	}
	a.cliRunID = cliCancelRunIDPrefix + a.cliRunID
	runID := strings.TrimPrefix(a.cliRunID, cliCancelRunIDPrefix)
	a.cliMu.Unlock()
	cancel()
	a.emitCLIEvent(models.CLIEvent{
		SchemaVersion: "cli-events/v1",
		Type:          "run.cancel_requested",
		RunID:         runID,
		Severity:      "warning",
		Code:          "cli.cancel_requested",
		Message:       "Stopping the CLI process. Any Core operation already accepted may continue; check its status before retrying.",
		Timestamp:     time.Now().UTC().Format(time.RFC3339Nano),
	})
}

func (a *App) clearCLICancel(generation uint64) {
	a.cliMu.Lock()
	if a.cliGeneration != generation {
		a.cliMu.Unlock()
		return
	}
	cancelled := strings.HasPrefix(a.cliRunID, cliCancelRunIDPrefix)
	runID := strings.TrimPrefix(a.cliRunID, cliCancelRunIDPrefix)
	a.cliCancel = nil
	a.cliRunID = ""
	a.cliMu.Unlock()
	if cancelled {
		a.emitCLIEvent(models.CLIEvent{
			SchemaVersion: "cli-events/v1",
			Type:          "run.cancelled",
			RunID:         runID,
			Severity:      "warning",
			Code:          "cli.observation_cancelled",
			Message:       "CLI observation stopped. Any Core operation already accepted may continue; check operation status before retrying.",
			Timestamp:     time.Now().UTC().Format(time.RFC3339Nano),
		})
	}
}

func (a *App) emitCLIEvent(event models.CLIEvent) {
	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, "studio.cli.event", safeCLIEvent(event))
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

// LatestReportSummary returns only safe deployment metadata for the active
// Project. Replica diagnostics and traffic payloads stay in the Go host.
func (a *App) LatestReportSummary() (models.ReportSummary, error) {
	workspace, err := a.workspace.Current(a.context())
	if err != nil {
		return models.ReportSummary{}, err
	}
	if workspace.Project == nil || a.reports == nil {
		return models.ReportSummary{}, nil
	}
	reports, err := a.reports.List(a.context(), workspace.Project.RootPath)
	if err != nil {
		return models.ReportSummary{}, err
	}
	if summary := models.LatestReportSummary(reports, workspace.Project.ID); summary != nil {
		return *summary, nil
	}
	return models.ReportSummary{}, nil
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
	return runtime.OpenFileDialog(a.ctx, studioPluginPackageDialogOptions())
}

func studioPluginPackageDialogOptions() runtime.OpenDialogOptions {
	// `.studio-plugin` is a custom ZIP-based extension without a registered
	// macOS UTI. Wails maps extension filters to UTType; an unknown extension
	// can make NSOpenPanel show the file but disable its Open button. Let the
	// installer validate the selected package's path, archive structure,
	// manifest and digest instead of filtering it at the native dialog layer.
	return runtime.OpenDialogOptions{Title: "Import Studio plugin"}
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

func (a *App) InstallStudioPlugin(packagePath string, expectedDigest string, approved bool, reason string, grantedPermissions []string) (string, error) {
	if a.plugins == nil {
		return "", models.ErrInvalidStudioPlugin
	}
	installed, err := a.plugins.Install(a.context(), packagePath, models.TrustDecision{ExpectedDigest: expectedDigest, Approved: approved, Reason: reason, GrantedPermissions: grantedPermissions})
	if err != nil {
		return "", err
	}
	data, err := json.Marshal(installed)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (a *App) InstalledStudioPlugins() ([]models.InstalledStudioPluginState, error) {
	if a.plugins == nil {
		return []models.InstalledStudioPluginState{}, nil
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

func (a *App) StudioPluginEditorBindings() (string, error) {
	if a.desktop == nil {
		return "[]", nil
	}
	items, err := a.desktop.ListStudioPluginEditorBindings(a.context())
	if err != nil {
		return "", err
	}
	encoded, err := json.Marshal(items)
	return string(encoded), err
}

func (a *App) SaveStudioPluginEditorBindings(encoded string) error {
	if a.desktop == nil || len(encoded) > 64*1024 {
		return models.ErrInvalidStudioPlugin
	}
	var items []models.StudioPluginEditorBinding
	if err := json.Unmarshal([]byte(encoded), &items); err != nil || items == nil || len(items) > 256 {
		return models.ErrInvalidStudioPlugin
	}
	seen := make(map[string]struct{}, len(items))
	for _, item := range items {
		if !models.ValidStudioPluginBindingID(item.ButtonID) || !models.ValidStudioPluginBindingID(item.PluginID) || !models.ValidStudioPluginBindingID(item.SurfaceID) {
			return models.ErrInvalidStudioPlugin
		}
		if _, duplicate := seen[item.ButtonID]; duplicate {
			return models.ErrInvalidStudioPlugin
		}
		seen[item.ButtonID] = struct{}{}
	}
	return a.desktop.ReplaceStudioPluginEditorBindings(a.context(), items)
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
	a.clearStudioPluginProcessDiagnostic(id, version)
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
			a.recordStudioPluginProcessFailure(root, id, version, status.ErrorCode)
		}
	}
	if err != nil {
		return string(data), err
	}
	return string(data), nil
}

func (a *App) recordStudioPluginProcessFailure(root, id, version, code string) {
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

func (a *App) clearStudioPluginProcessDiagnostic(id, version string) {
	a.pluginDiagMu.Lock()
	delete(a.pluginDiag, processDiagnosticKey(id, version))
	a.pluginDiagMu.Unlock()
}

func processDiagnosticKey(id, version string) string { return id + "@" + version }

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

func (a *App) importReportContext(ctx context.Context, path string) error {
	workspace, err := a.workspace.Current(ctx)
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
		data, err = a.files.ReadFile(ctx, workspace.Project.RootPath, filepath.ToSlash(path))
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
	report.ImportedAt = time.Now().UTC().Format(time.RFC3339Nano)
	_, err = a.reports.Save(ctx, workspace.Project.RootPath, report, nil)
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
