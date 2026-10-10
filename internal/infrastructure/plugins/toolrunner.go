package plugins

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/Liapoldus/studio/internal/domain/interfaces"
	"github.com/Liapoldus/studio/internal/domain/models"
	projectfiles "github.com/Liapoldus/studio/internal/infrastructure/filesystem"
)

var (
	ErrToolNotFound = errors.New("companion tool is not declared by the plugin")
	ErrToolPlatform = errors.New("companion tool is not available on this platform")
	ErrToolOutput   = errors.New("companion tool output exceeded limit")
	ErrToolTimeout  = errors.New("companion tool timed out")
)

const toolOutputLimit = 1024 * 1024
const defaultToolTimeout = 5 * time.Minute

type ToolRunner struct {
	Sandbox ProcessSandbox
	Mode    SandboxMode
}

var _ interfaces.CompanionToolRunner = ToolRunner{}

func (runner ToolRunner) Run(ctx context.Context, request models.ToolExecutionRequest) (models.ToolExecutionResult, error) {
	if err := validateToolRequest(request); err != nil {
		return models.ToolExecutionResult{}, err
	}
	tool, ok := findTool(request.Manifest, request.ToolID)
	if !ok {
		return models.ToolExecutionResult{}, ErrToolNotFound
	}
	if !platformSupported(tool.Platforms) {
		return models.ToolExecutionResult{}, ErrToolPlatform
	}
	executable, err := safeToolExecutable(request.PluginPath, tool.Executable)
	if err != nil {
		return models.ToolExecutionResult{}, err
	}
	workingDir := filepath.Clean(request.ProjectRoot)
	if request.WorkingDir != "" {
		workingDir, err = projectfiles.ResolvePath(request.ProjectRoot, request.WorkingDir)
		if err != nil {
			return models.ToolExecutionResult{}, err
		}
	}
	timeout := defaultToolTimeout
	if tool.TimeoutMillis > 0 {
		timeout = time.Duration(tool.TimeoutMillis) * time.Millisecond
	}
	if timeout <= 0 || timeout > 30*time.Minute {
		return models.ToolExecutionResult{}, models.ErrInvalidStudioPlugin
	}
	toolContext, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	command, sandboxed, warning, err := runnerCommand(toolContext, runner, executable, request.Args, sandboxPolicy(request.ProjectRoot, request.PluginPath, request.Manifest.Permissions, tool.Permissions))
	if err != nil {
		return models.ToolExecutionResult{}, err
	}
	command.Dir = workingDir
	command.Env = allowlistedEnvironment(tool.Environment)
	var stdout, stderr limitedBuffer
	command.Stdout = &stdout
	command.Stderr = &stderr
	waitErr := command.Run()
	result := models.ToolExecutionResult{
		ToolID:    tool.ID,
		Version:   tool.Version,
		Digest:    request.Digest,
		Stdout:    models.RedactText(string(stdout.data)),
		Stderr:    models.RedactText(string(stderr.data)),
		Truncated: stdout.truncated || stderr.truncated,
		TimedOut:  errors.Is(toolContext.Err(), context.DeadlineExceeded),
		Sandboxed: sandboxed,
		Warning:   warning,
	}
	if result.TimedOut {
		result.ExitCode = -1
		return result, ErrToolTimeout
	}
	if result.Truncated {
		return result, ErrToolOutput
	}
	if waitErr == nil {
		return result, nil
	}
	result.ExitCode = 1
	var exitError *exec.ExitError
	if errors.As(waitErr, &exitError) {
		result.ExitCode = exitError.ExitCode()
	}
	return result, waitErr
}

func runnerCommand(ctx context.Context, runner ToolRunner, executable string, arguments []string, policy SandboxPolicy) (*exec.Cmd, bool, string, error) {
	if runner.Mode == "" || runner.Mode == SandboxDisabled {
		return exec.CommandContext(ctx, executable, arguments...), false, "", nil
	}
	if runner.Sandbox == nil {
		if runner.Mode == SandboxRequired {
			return nil, false, "sandbox.unavailable", ErrSandboxUnavailable
		}
		return exec.CommandContext(ctx, executable, arguments...), false, "sandbox.unavailable", nil
	}
	command, err := runner.Sandbox.Command(ctx, executable, arguments, policy)
	if err == nil {
		return command, true, "", nil
	}
	if runner.Mode == SandboxRequired {
		return nil, false, "sandbox.unavailable", err
	}
	return exec.CommandContext(ctx, executable, arguments...), false, "sandbox.unavailable", nil
}

func sandboxPolicy(projectRoot, packageRoot string, permissions []string, toolPermissions map[string]any) SandboxPolicy {
	return SandboxPolicy{
		PackageRoot:  filepath.Clean(packageRoot),
		ProjectRoot:  filepath.Clean(projectRoot),
		WriteProject: permissionDeclared(permissions, toolPermissions, "project.write", "build.write", "build-write"),
		Network:      permissionDeclared(permissions, toolPermissions, "network", "network.access"),
	}
}

func permissionDeclared(global []string, local map[string]any, names ...string) bool {
	globalDeclared := false
	for _, permission := range global {
		for _, name := range names {
			if strings.EqualFold(strings.TrimSpace(permission), name) {
				globalDeclared = true
			}
		}
	}
	if !globalDeclared {
		return false
	}
	for key, value := range local {
		for _, name := range names {
			if strings.EqualFold(strings.TrimSpace(key), name) {
				if allowed, ok := value.(bool); ok && !allowed {
					return false
				}
			}
		}
	}
	return true
}

type limitedBuffer struct {
	data      []byte
	truncated bool
}

func (buffer *limitedBuffer) Write(data []byte) (int, error) {
	remaining := toolOutputLimit - len(buffer.data)
	if remaining <= 0 {
		buffer.truncated = true
		return len(data), nil
	}
	if len(data) > remaining {
		buffer.data = append(buffer.data, data[:remaining]...)
		buffer.truncated = true
		return len(data), nil
	}
	buffer.data = append(buffer.data, data...)
	return len(data), nil
}

func validateToolRequest(request models.ToolExecutionRequest) error {
	if !filepath.IsAbs(request.PluginPath) || !filepath.IsAbs(request.ProjectRoot) || strings.ContainsRune(request.PluginPath, '\x00') || strings.ContainsRune(request.ProjectRoot, '\x00') || strings.TrimSpace(request.ToolID) == "" {
		return models.ErrInvalidStudioPlugin
	}
	for _, argument := range request.Args {
		if strings.ContainsRune(argument, '\x00') {
			return models.ErrInvalidStudioPlugin
		}
	}
	return nil
}

func allowlistedEnvironment(names []string) []string {
	environment := make([]string, 0, len(names))
	for _, name := range names {
		if value, ok := os.LookupEnv(name); ok {
			environment = append(environment, name+"="+value)
		}
	}
	return environment
}

func findTool(manifest models.StudioPluginManifest, id string) (models.CompanionTool, bool) {
	for _, tool := range manifest.Tools {
		if tool.ID == id {
			return tool, true
		}
	}
	return models.CompanionTool{}, false
}

func platformSupported(platforms []string) bool {
	if len(platforms) == 0 {
		return true
	}
	current := runtime.GOOS + "/" + runtime.GOARCH
	for _, platform := range platforms {
		if platform == current || platform == runtime.GOOS || platform == "*" {
			return true
		}
	}
	return false
}

func safeToolExecutable(root, relative string) (string, error) {
	if strings.TrimSpace(relative) == "" || filepath.IsAbs(relative) || strings.ContainsRune(relative, '\x00') {
		return "", models.ErrInvalidStudioPlugin
	}
	clean := filepath.Clean(filepath.FromSlash(relative))
	if clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", models.ErrInvalidStudioPlugin
	}
	path := filepath.Join(filepath.Clean(root), clean)
	relativeRoot, err := filepath.Rel(filepath.Clean(root), path)
	if err != nil || relativeRoot == ".." || strings.HasPrefix(relativeRoot, ".."+string(filepath.Separator)) {
		return "", models.ErrInvalidStudioPlugin
	}
	if symlinkErr := rejectPackageSymlinks(filepath.Clean(root), clean); symlinkErr != nil {
		return "", symlinkErr
	}
	info, err := os.Lstat(path)
	if err != nil || info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", models.ErrInvalidStudioPlugin
	}
	return path, nil
}

func rejectPackageSymlinks(root, relative string) error {
	current := root
	for _, part := range strings.Split(relative, string(filepath.Separator)) {
		current = filepath.Join(current, part)
		info, err := os.Lstat(current)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil || info.Mode()&os.ModeSymlink != 0 {
			return models.ErrInvalidStudioPlugin
		}
	}
	return nil
}
