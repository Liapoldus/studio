package cli

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/Liapoldus/studio/internal/domain/interfaces"
	"github.com/Liapoldus/studio/internal/domain/models"
)

var _ interfaces.ToolchainProbe = ToolchainProbe{}

// ToolchainProbe discovers the standalone CLI through the OS executable
// resolver and asks only for its version. The command and arguments are fixed
// constants; no user-controlled shell or environment is involved.
type ToolchainProbe struct {
	LookPath    func(string) (string, error)
	ReadVersion func(context.Context, string) ([]byte, error)
}

func (p ToolchainProbe) Status(ctx context.Context) models.ToolchainStatus {
	path, err := resolveCLI(p.LookPath)
	if err != nil {
		return models.ToolchainStatus{ErrorCode: "cli.unavailable"}
	}
	status := models.ToolchainStatus{CLIAvailable: true, CLIPath: path}
	readVersion := p.ReadVersion
	if readVersion == nil {
		readVersion = func(commandContext context.Context, executable string) ([]byte, error) {
			return exec.CommandContext(commandContext, executable, "version").Output()
		}
	}
	output, err := readVersion(ctx, path)
	if err != nil {
		status.ErrorCode = "cli.probe"
		return status
	}
	output = output[:min(len(output), 64*1024)]
	var payload struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(output, &payload); err != nil || strings.TrimSpace(payload.Version) == "" {
		status.ErrorCode = "cli.protocol"
		return status
	}
	status.CLIVersion = strings.TrimSpace(payload.Version)
	return status
}

// resolveCLI keeps GUI launches usable when macOS/Windows do not inherit the
// user's interactive shell PATH. An explicit STUDIO_CLI_PATH wins; otherwise
// the normal resolver is tried before conventional user/system install paths.
func resolveCLI(lookPath func(string) (string, error)) (string, error) {
	if lookPath != nil {
		return lookPath("liapoldus")
	}
	if configured := strings.TrimSpace(os.Getenv("STUDIO_CLI_PATH")); configured != "" {
		if !filepath.IsAbs(configured) || !isExecutable(configured) {
			return "", errors.New("configured Studio CLI path is unavailable")
		}
		return filepath.Clean(configured), nil
	}
	if path, err := exec.LookPath("liapoldus"); err == nil {
		return path, nil
	}
	for _, candidate := range cliCandidates() {
		if isExecutable(candidate) {
			return candidate, nil
		}
	}
	return "", errors.New("liapoldus CLI is unavailable")
}

func cliCandidates() []string {
	result := make([]string, 0, 4)
	if home, err := os.UserHomeDir(); err == nil {
		result = append(result, filepath.Join(home, "go", "bin", executableName()))
	}
	if executableName() == "liapoldus" {
		result = append(result, "/usr/local/bin/liapoldus", "/opt/homebrew/bin/liapoldus")
	}
	return result
}

func executableName() string {
	if filepath.Ext(os.Args[0]) == ".exe" || strings.EqualFold(os.Getenv("OS"), "Windows_NT") {
		return "liapoldus.exe"
	}
	return "liapoldus"
}

func isExecutable(path string) bool {
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() {
		return false
	}
	if executableName() == "liapoldus.exe" {
		return true
	}
	return info.Mode().Perm()&0111 != 0
}

func min(left, right int) int {
	if left < right {
		return left
	}
	return right
}
