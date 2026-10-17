package cli

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/Liapoldus/studio/internal/domain/interfaces"
	"github.com/Liapoldus/studio/internal/domain/models"
)

var _ interfaces.ToolchainProbe = ToolchainProbe{}

// ToolchainProbe discovers the standalone CLI through the OS executable
// resolver and verifies a fixed, read-only typed command contract. No
// user-controlled shell or environment is involved.
type ToolchainProbe struct {
	LookPath     func(string) (string, error)
	ReadContract func(context.Context, string) ([]byte, error)
}

func (p ToolchainProbe) Status(ctx context.Context) models.ToolchainStatus {
	path, err := resolveCLI(p.LookPath)
	if err != nil {
		return models.ToolchainStatus{ErrorCode: "cli.unavailable"}
	}
	status, err := p.inspect(ctx, path, false)
	if err != nil {
		return status
	}
	return status
}

func (p ToolchainProbe) Inspect(ctx context.Context, path string) (models.ToolchainStatus, error) {
	return p.inspect(ctx, path, true)
}

func (p ToolchainProbe) inspect(ctx context.Context, path string, validate bool) (models.ToolchainStatus, error) {
	path = filepath.Clean(strings.TrimSpace(path))
	if !filepath.IsAbs(path) || (validate && !isExecutable(path)) {
		return models.ToolchainStatus{}, errors.New("selected CLI executable is unavailable")
	}
	status := models.ToolchainStatus{CLIAvailable: true, CLIPath: path}
	readContract := p.ReadContract
	if readContract == nil {
		readContract = func(commandContext context.Context, executable string) ([]byte, error) {
			probeContext, cancel := context.WithTimeout(commandContext, 5*time.Second)
			defer cancel()
			command := exec.CommandContext(probeContext, executable, "target", "list", "--studio-events")
			output, runErr := command.Output()
			if runErr != nil {
				return nil, runErr
			}
			if len(output) > 64*1024 {
				return nil, errors.New("CLI contract probe output exceeded its limit")
			}
			return output, nil
		}
	}
	output, err := readContract(ctx, path)
	if err != nil || validateContractProbe(output) != nil {
		status.ErrorCode = "cli.probe"
		return status, errors.New("selected CLI does not implement the Studio JSONL command contract")
	}
	return status, nil
}

func validateContractProbe(output []byte) error {
	if len(output) == 0 || len(output) > 64*1024 {
		return errors.New("invalid CLI contract probe output size")
	}
	scanner := bufio.NewScanner(strings.NewReader(string(output)))
	scanner.Buffer(make([]byte, 4096), 64*1024)
	started, completed := false, false
	for scanner.Scan() {
		var event models.CLIEvent
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil || !event.Valid() {
			return errors.New("invalid CLI JSONL event")
		}
		switch event.Type {
		case "run.started":
			started = true
		case "run.failed", "run.cancelled":
			return errors.New("CLI contract probe failed")
		case "run.completed":
			completed = true
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	if !started || !completed {
		return errors.New("CLI contract probe did not complete")
	}
	return nil
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
	info, err := os.Stat(path) //nolint:gosec // candidates come from LookPath or an explicit absolute executable setting.
	if err != nil || !info.Mode().IsRegular() {
		return false
	}
	if executableName() == "liapoldus.exe" {
		return true
	}
	return info.Mode().Perm()&0111 != 0
}
