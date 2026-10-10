package plugins

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

var ErrSandboxUnavailable = errors.New("OS sandbox is unavailable for Studio plugin execution")

type SandboxMode string

const (
	SandboxDisabled   SandboxMode = "disabled"
	SandboxBestEffort SandboxMode = "best-effort"
	SandboxRequired   SandboxMode = "required"
)

type SandboxPolicy struct {
	PackageRoot  string
	ProjectRoot  string
	WriteProject bool
	Network      bool
}

type ProcessSandbox interface {
	Command(context.Context, string, []string, SandboxPolicy) (*exec.Cmd, error)
	Available() bool
}

type platformSandbox struct {
	kind   string
	binary string
}

func NewToolRunnerFromENV() (ToolRunner, error) {
	mode := SandboxBestEffort
	switch SandboxMode(strings.TrimSpace(os.Getenv("STUDIO_PLUGIN_SANDBOX_MODE"))) {
	case "", SandboxBestEffort:
	case SandboxDisabled:
		mode = SandboxDisabled
	case SandboxRequired:
		mode = SandboxRequired
	default:
		return ToolRunner{}, ErrSandboxUnavailable
	}
	sandbox, sandboxErr := newPlatformSandbox()
	if mode == SandboxRequired && sandboxErr != nil {
		return ToolRunner{}, sandboxErr
	}
	return ToolRunner{Sandbox: sandbox, Mode: mode}, nil
}

func (sandbox platformSandbox) Available() bool {
	return sandbox.binary != ""
}

func (sandbox platformSandbox) Command(ctx context.Context, executable string, arguments []string, policy SandboxPolicy) (*exec.Cmd, error) {
	if !sandbox.Available() || !filepath.IsAbs(executable) || !filepath.IsAbs(policy.PackageRoot) || !filepath.IsAbs(policy.ProjectRoot) {
		return nil, ErrSandboxUnavailable
	}
	if sandbox.kind == "darwin" {
		profile := darwinSandboxProfile(policy)
		args := []string{"-p", profile, executable}
		args = append(args, arguments...)
		return exec.CommandContext(ctx, sandbox.binary, args...), nil //nolint:gosec // binary is a platform-owned sandbox executable.
	}
	if sandbox.kind == "linux" {
		relative, err := filepath.Rel(policy.PackageRoot, executable)
		if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
			return nil, ErrSandboxUnavailable
		}
		inside := filepath.ToSlash(filepath.Join("/plugin", relative))
		args := []string{"--die-with-parent", "--unshare-all", "--new-session", "--ro-bind", "/usr", "/usr", "--ro-bind", "/bin", "/bin", "--ro-bind", "/lib", "/lib", "--ro-bind", "/lib64", "/lib64", "--ro-bind", "/etc", "/etc", "--dev", "/dev", "--proc", "/proc", "--tmpfs", "/tmp", "--ro-bind", policy.PackageRoot, "/plugin"}
		if policy.WriteProject {
			args = append(args, "--bind", policy.ProjectRoot, "/project")
		} else {
			args = append(args, "--ro-bind", policy.ProjectRoot, "/project")
		}
		args = append(args, "--chdir", "/project")
		if policy.Network {
			args = append(args, "--share-net")
		}
		args = append(args, "--", inside)
		args = append(args, arguments...)
		return exec.CommandContext(ctx, sandbox.binary, args...), nil //nolint:gosec // binary is a platform-owned sandbox executable.
	}
	if sandbox.kind == "windows" {
		relative, err := filepath.Rel(policy.PackageRoot, executable)
		if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
			return nil, ErrSandboxUnavailable
		}
		args := []string{
			"--package-root", policy.PackageRoot,
			"--project-root", policy.ProjectRoot,
			"--write-project", strconv.FormatBool(policy.WriteProject),
			"--network", strconv.FormatBool(policy.Network),
			"--", executable,
		}
		args = append(args, arguments...)
		command := exec.CommandContext(ctx, sandbox.binary, args...) //nolint:gosec // helper path is validated by the platform adapter before construction.
		command.Dir = policy.ProjectRoot
		return command, nil
	}
	return nil, ErrSandboxUnavailable
}

func darwinSandboxProfile(policy SandboxPolicy) string {
	profile := `(version 1)(deny default)(allow process*)(allow file-read* (subpath "/usr")(subpath "/System")(subpath "/private/var/db"))`
	profile += `(allow file-read* (subpath ` + sandboxPath(policy.PackageRoot) + `)(subpath ` + sandboxPath(policy.ProjectRoot) + `))`
	if policy.WriteProject {
		profile += `(allow file-write* (subpath ` + sandboxPath(policy.ProjectRoot) + `))`
	}
	if policy.Network {
		profile += `(allow network*)`
	}
	return profile
}

func sandboxPath(path string) string {
	path = strings.ReplaceAll(path, `\`, `\\`)
	path = strings.ReplaceAll(path, `"`, `\"`)
	return `"` + path + `"`
}
