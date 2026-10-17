package plugins

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/Liapoldus/studio/internal/domain/interfaces"
	"github.com/Liapoldus/studio/internal/domain/models"
)

var (
	ErrPluginDisabled        = errors.New("studio plugin is disabled")
	ErrPluginProcessMissing  = errors.New("studio plugin process is not declared")
	ErrPluginProcessNotFound = errors.New("studio plugin process is not running")
	ErrPluginProcessRunning  = errors.New("stop the Studio plugin process before removing this version")
)

//nolint:govet // host dependencies remain grouped by lifecycle responsibility.
type Host struct {
	Store        interfaces.DesktopStore
	Tools        interfaces.CompanionToolRunner
	Installer    *Installer
	Sandbox      ProcessSandbox
	SandboxMode  SandboxMode
	processState *processSupervisor
}

var _ interfaces.StudioPluginHost = (*Host)(nil)

type managedProcess struct {
	cancel context.CancelFunc
	cmd    *exec.Cmd
	status models.StudioPluginProcessStatus
}

type processSupervisor struct {
	processes map[string]*managedProcess
}

var processSupervisorMu sync.Mutex

func NewHost(store interfaces.DesktopStore, tools interfaces.CompanionToolRunner, installer Installer) *Host {
	return &Host{Store: store, Tools: tools, Installer: &installer, processState: &processSupervisor{processes: make(map[string]*managedProcess)}}
}

func (h *Host) supervisor() *processSupervisor {
	if h.processState == nil {
		h.processState = &processSupervisor{processes: make(map[string]*managedProcess)}
	}
	return h.processState
}

func (h *Host) Inspect(ctx context.Context, packagePath string) (models.StudioPluginInspection, error) {
	return h.Installer.Inspect(ctx, packagePath)
}

func (h *Host) Install(ctx context.Context, packagePath string, trust models.TrustDecision) (models.InstalledStudioPlugin, error) {
	if h.Store == nil {
		return models.InstalledStudioPlugin{}, models.ErrInvalidStudioPlugin
	}
	installed, err := h.Installer.Install(ctx, packagePath, trust)
	if err != nil {
		return models.InstalledStudioPlugin{}, err
	}
	if err := h.Store.SaveTrustState(ctx, models.TrustState{Digest: installed.Digest, Approved: trust.Approved, Reason: trust.Reason, GrantedPermissions: trust.GrantedPermissions}); err != nil {
		discardError(os.RemoveAll(installed.Path))
		return models.InstalledStudioPlugin{}, err
	}
	if err := h.Store.SaveInstalledStudioPlugin(ctx, models.InstalledStudioPluginState{
		ID: installed.Manifest.ID, Version: installed.Manifest.Version, Digest: installed.Digest,
		Path: installed.Path, Enabled: true, Signed: installed.Manifest.Signature != "",
	}); err != nil {
		discardError(os.RemoveAll(installed.Path))
		return models.InstalledStudioPlugin{}, err
	}
	return installed, nil
}

func (h *Host) List(ctx context.Context) ([]models.InstalledStudioPluginState, error) {
	if h.Store == nil {
		return []models.InstalledStudioPluginState{}, nil
	}
	return h.Store.ListInstalledStudioPlugins(ctx)
}

func (h *Host) Remove(ctx context.Context, id, version string) error {
	if h.Store == nil || h.Installer == nil || strings.TrimSpace(id) == "" || strings.TrimSpace(version) == "" {
		return models.ErrInvalidStudioPlugin
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	state, _, err := h.installedManifest(ctx, id, version)
	if err != nil {
		return err
	}
	supervisor := h.supervisor()
	processSupervisorMu.Lock()
	managed := supervisor.processes[processKey(id, version)]
	running := managed != nil && (managed.status.State == "starting" || managed.status.State == "running" || managed.status.State == "stopping")
	processSupervisorMu.Unlock()
	if running {
		return ErrPluginProcessRunning
	}
	expected := filepath.Join(filepath.Clean(h.Installer.Directory), id, version)
	if filepath.Clean(state.Path) != expected {
		return models.ErrInvalidStudioPlugin
	}
	if err := rejectPackageSymlinks(filepath.Clean(h.Installer.Directory), filepath.Join(id, version)); err != nil {
		return err
	}
	if err := h.Store.DeleteInstalledStudioPlugin(ctx, id, version); err != nil {
		return err
	}
	if err := os.RemoveAll(expected); err != nil {
		return errors.Join(err, h.Store.SaveInstalledStudioPlugin(ctx, state))
	}
	return nil
}

func (h *Host) Manifests(ctx context.Context) ([]models.StudioPluginInspection, error) {
	if h.Store == nil {
		return []models.StudioPluginInspection{}, nil
	}
	installed, err := h.Store.ListInstalledStudioPlugins(ctx)
	if err != nil {
		return nil, err
	}
	result := make([]models.StudioPluginInspection, 0, len(installed))
	for _, state := range installed {
		manifest, manifestErr := h.Installer.verifyInstalled(state.Path)
		if manifestErr != nil {
			continue
		}
		trust, trustErr := h.Store.ReadTrustState(ctx, state.Digest)
		if trustErr != nil {
			continue
		}
		result = append(result, models.StudioPluginInspection{Manifest: manifest, Digest: state.Digest, GrantedPermissions: trust.GrantedPermissions, Signed: state.Signed})
	}
	return result, nil
}

func (h *Host) Surface(ctx context.Context, id, version, surfaceID string) (string, error) {
	if h.Store == nil || strings.TrimSpace(id) == "" || strings.TrimSpace(version) == "" || strings.TrimSpace(surfaceID) == "" {
		return "", models.ErrInvalidStudioPlugin
	}
	installed, err := h.Store.ListInstalledStudioPlugins(ctx)
	if err != nil {
		return "", err
	}
	for _, state := range installed {
		if state.ID != id || state.Version != version {
			continue
		}
		if !state.Enabled {
			return "", ErrPluginDisabled
		}
		manifest, manifestErr := h.Installer.verifyInstalled(state.Path)
		if manifestErr != nil {
			return "", manifestErr
		}
		for _, surface := range manifest.Surfaces {
			if surface.ID != surfaceID {
				continue
			}
			var schema json.RawMessage = []byte("{}")
			if surface.Schema != "" {
				path, pathErr := safeToolExecutable(state.Path, surface.Schema)
				if pathErr != nil {
					return "", models.ErrInvalidStudioPlugin
				}
				data, readErr := os.ReadFile(path) //nolint:gosec // path is inside a verified installed package.
				if readErr != nil || !json.Valid(data) {
					return "", models.ErrInvalidStudioPlugin
				}
				schema = data
			}
			payload, marshalErr := json.Marshal(struct {
				Surface models.StudioPluginSurface `json:"surface"`
				Schema  json.RawMessage            `json:"schema"`
			}{Surface: surface, Schema: schema})
			if marshalErr != nil {
				return "", models.ErrInvalidStudioPlugin
			}
			return string(payload), nil
		}
		return "", ErrToolNotFound
	}
	return "", models.ErrInvalidStudioPlugin
}

// SurfaceAsset returns a bounded file from the directory containing a verified
// page/panel entry point. It deliberately cannot serve arbitrary package files.
func (h *Host) SurfaceAsset(ctx context.Context, id, version, surfaceID, assetPath string) ([]byte, string, error) {
	if h.Store == nil || h.Installer == nil || strings.TrimSpace(id) == "" || strings.TrimSpace(version) == "" || strings.TrimSpace(surfaceID) == "" {
		return nil, "", models.ErrInvalidStudioPlugin
	}
	if err := ctx.Err(); err != nil {
		return nil, "", err
	}
	installed, err := h.Store.ListInstalledStudioPlugins(ctx)
	if err != nil {
		return nil, "", err
	}
	for _, state := range installed {
		if state.ID != id || state.Version != version {
			continue
		}
		if !state.Enabled {
			return nil, "", ErrPluginDisabled
		}
		manifest, verifyErr := h.Installer.verifyInstalled(state.Path)
		if verifyErr != nil {
			return nil, "", verifyErr
		}
		for _, surface := range manifest.Surfaces {
			if surface.ID != surfaceID || (surface.Kind != "page" && surface.Kind != "panel") || surface.Route == "" {
				continue
			}
			cleanAsset := filepath.ToSlash(assetPath)
			if strings.ContainsAny(cleanAsset, "\\:\x00") || strings.HasPrefix(cleanAsset, "/") {
				return nil, "", models.ErrInvalidStudioPlugin
			}
			assetParts := strings.Split(cleanAsset, "/")
			for _, part := range assetParts {
				if part == "" || part == "." || part == ".." {
					return nil, "", models.ErrInvalidStudioPlugin
				}
			}
			entryDirectory := filepath.ToSlash(filepath.Dir(filepath.FromSlash(surface.Route)))
			if entryDirectory == "." {
				entryDirectory = ""
			}
			if entryDirectory != "" && cleanAsset != entryDirectory && !strings.HasPrefix(cleanAsset, entryDirectory+"/") {
				return nil, "", models.ErrInvalidStudioPlugin
			}
			path, pathErr := safeToolExecutable(state.Path, filepath.FromSlash(cleanAsset))
			if pathErr != nil {
				return nil, "", pathErr
			}
			file, openErr := os.Open(path) //nolint:gosec // path is confined below the verified installed package.
			if openErr != nil {
				return nil, "", models.ErrInvalidStudioPlugin
			}
			info, statErr := file.Stat()
			if statErr != nil || !info.Mode().IsRegular() || info.Size() < 0 || info.Size() > maxPluginFileBytes {
				if closeErr := file.Close(); closeErr != nil {
					return nil, "", errors.Join(models.ErrInvalidStudioPlugin, closeErr)
				}
				return nil, "", models.ErrInvalidStudioPlugin
			}
			data, readErr := io.ReadAll(io.LimitReader(file, maxPluginFileBytes+1))
			closeErr := file.Close()
			if readErr != nil || closeErr != nil || len(data) > maxPluginFileBytes {
				return nil, "", models.ErrInvalidStudioPlugin
			}
			contentType := mime.TypeByExtension(filepath.Ext(path))
			if contentType == "" {
				contentType = "application/octet-stream"
			}
			return data, contentType, nil
		}
		return nil, "", models.ErrInvalidStudioPlugin
	}
	return nil, "", models.ErrInvalidStudioPlugin
}

func (h *Host) RunTool(ctx context.Context, id, version, toolID, projectRoot string, args []string) (models.ToolExecutionResult, error) {
	if h.Store == nil || h.Tools == nil || strings.TrimSpace(id) == "" || strings.TrimSpace(version) == "" {
		return models.ToolExecutionResult{}, models.ErrInvalidStudioPlugin
	}
	var installed *models.InstalledStudioPluginState
	plugins, err := h.Store.ListInstalledStudioPlugins(ctx)
	if err != nil {
		return models.ToolExecutionResult{}, err
	}
	for index := range plugins {
		if plugins[index].ID == id && plugins[index].Version == version {
			installed = &plugins[index]
			break
		}
	}
	if installed == nil {
		return models.ToolExecutionResult{}, models.ErrInvalidStudioPlugin
	}
	if !installed.Enabled {
		return models.ToolExecutionResult{}, ErrPluginDisabled
	}
	manifest, err := h.Installer.verifyInstalled(installed.Path)
	if err != nil {
		return models.ToolExecutionResult{}, err
	}
	if err := h.requirePermissions(ctx, *installed, manifest); err != nil {
		return models.ToolExecutionResult{}, err
	}
	return h.Tools.Run(ctx, models.ToolExecutionRequest{
		PluginPath: installed.Path, ProjectRoot: projectRoot, ToolID: toolID,
		Digest: installed.Digest, Args: args, Manifest: manifest,
	})
}

func (h *Host) StartProcess(ctx context.Context, id, version, projectRoot string) (models.StudioPluginProcessStatus, error) {
	if h.Store == nil || strings.TrimSpace(id) == "" || strings.TrimSpace(version) == "" || !filepath.IsAbs(projectRoot) {
		return models.StudioPluginProcessStatus{}, models.ErrInvalidStudioPlugin
	}
	state, manifest, err := h.installedManifest(ctx, id, version)
	if err != nil {
		return models.StudioPluginProcessStatus{}, err
	}
	if !state.Enabled {
		return models.StudioPluginProcessStatus{}, ErrPluginDisabled
	}
	if manifest.Process == nil {
		return models.StudioPluginProcessStatus{}, ErrPluginProcessMissing
	}
	if permissionErr := h.requirePermissions(ctx, state, manifest); permissionErr != nil {
		return models.StudioPluginProcessStatus{}, permissionErr
	}
	if !platformSupported(manifest.Process.Platforms) {
		return models.StudioPluginProcessStatus{}, ErrToolPlatform
	}
	executable, err := safeToolExecutable(state.Path, manifest.Process.Executable)
	if err != nil {
		return models.StudioPluginProcessStatus{}, err
	}
	if info, statErr := os.Stat(projectRoot); statErr != nil || !info.IsDir() {
		return models.StudioPluginProcessStatus{}, models.ErrInvalidStudioPlugin
	}
	key := processKey(id, version)
	supervisor := h.supervisor()
	processSupervisorMu.Lock()
	if running := supervisor.processes[key]; running != nil && (running.status.State == "starting" || running.status.State == "running" || running.status.State == "stopping") {
		status := running.status
		processSupervisorMu.Unlock()
		return status, nil
	}
	processContext, cancel := context.WithCancel(ctx)
	if manifest.Process.TimeoutMillis > 0 {
		if manifest.Process.TimeoutMillis > int64((30*time.Minute)/time.Millisecond) {
			cancel()
			processSupervisorMu.Unlock()
			return models.StudioPluginProcessStatus{}, models.ErrInvalidStudioPlugin
		}
		processContext, cancel = context.WithTimeout(ctx, time.Duration(manifest.Process.TimeoutMillis)*time.Millisecond)
	}
	command, sandboxed, warning, commandErr := runnerCommand(processContext, ToolRunner{Sandbox: h.Sandbox, Mode: h.SandboxMode}, executable, nil, sandboxPolicy(projectRoot, state.Path, manifest.Permissions, nil))
	if commandErr != nil {
		cancel()
		processSupervisorMu.Unlock()
		return models.StudioPluginProcessStatus{}, commandErr
	}
	command.Dir = filepath.Clean(projectRoot)
	command.Env = allowlistedEnvironment(manifest.Process.Environment)
	managed := &managedProcess{cancel: cancel, cmd: command, status: models.StudioPluginProcessStatus{StudioPluginID: id, Version: version, State: "starting", Sandboxed: sandboxed, Warning: warning}}
	supervisor.processes[key] = managed
	processSupervisorMu.Unlock()
	if err := command.Start(); err != nil {
		cancel()
		processSupervisorMu.Lock()
		managed.status.State = "failed"
		managed.status.ErrorCode = "process.start"
		processSupervisorMu.Unlock()
		return managed.status, err
	}
	processSupervisorMu.Lock()
	managed.status.State = "running"
	status := managed.status
	processSupervisorMu.Unlock()
	go h.waitProcess(key, managed, processContext)
	return status, nil
}

func (h *Host) waitProcess(key string, managed *managedProcess, processContext context.Context) {
	err := managed.cmd.Wait()
	supervisor := h.supervisor()
	processSupervisorMu.Lock()
	defer processSupervisorMu.Unlock()
	if supervisor.processes[key] != managed {
		return
	}
	switch {
	case errors.Is(processContext.Err(), context.DeadlineExceeded):
		managed.status.State, managed.status.ErrorCode = "failed", "process.timeout"
	case err != nil && !errors.Is(processContext.Err(), context.Canceled):
		managed.status.State, managed.status.ErrorCode = "failed", "process.exit"
	default:
		managed.status.State, managed.status.ErrorCode = "stopped", ""
	}
}

func (h *Host) StopProcess(_ context.Context, id, version string) error {
	key := processKey(id, version)
	supervisor := h.supervisor()
	processSupervisorMu.Lock()
	managed := supervisor.processes[key]
	if managed == nil {
		processSupervisorMu.Unlock()
		return ErrPluginProcessNotFound
	}
	managed.status.State = "stopping"
	managed.cancel()
	processSupervisorMu.Unlock()
	return nil
}

func (h *Host) ProcessStatus(_ context.Context, id, version string) (models.StudioPluginProcessStatus, error) {
	supervisor := h.supervisor()
	processSupervisorMu.Lock()
	defer processSupervisorMu.Unlock()
	managed := supervisor.processes[processKey(id, version)]
	if managed == nil {
		return models.StudioPluginProcessStatus{}, ErrPluginProcessNotFound
	}
	return managed.status, nil
}

func (h *Host) installedManifest(ctx context.Context, id, version string) (models.InstalledStudioPluginState, models.StudioPluginManifest, error) {
	plugins, err := h.Store.ListInstalledStudioPlugins(ctx)
	if err != nil {
		return models.InstalledStudioPluginState{}, models.StudioPluginManifest{}, err
	}
	for _, state := range plugins {
		if state.ID == id && state.Version == version {
			manifest, manifestErr := h.Installer.verifyInstalled(state.Path)
			return state, manifest, manifestErr
		}
	}
	return models.InstalledStudioPluginState{}, models.StudioPluginManifest{}, models.ErrInvalidStudioPlugin
}

func (h *Host) requirePermissions(ctx context.Context, state models.InstalledStudioPluginState, manifest models.StudioPluginManifest) error {
	trust, err := h.Store.ReadTrustState(ctx, state.Digest)
	if err != nil {
		return err
	}
	if !trust.Approved || !permissionsApproved(manifest.Permissions, trust.GrantedPermissions) {
		return models.ErrPermissionApprovalRequired
	}
	return nil
}

func processKey(id, version string) string { return id + "@" + version }
