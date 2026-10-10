package cli

import (
	"context"
	"encoding/json"
	"os/exec"
	"strings"

	"github.com/Liapoldus/studio/internal/domain/interfaces"
	"github.com/Liapoldus/studio/internal/domain/models"
)

var _ interfaces.ToolchainProbe = ToolchainProbe{}

// ToolchainProbe discovers the standalone CLI through the OS executable
// resolver and asks only for its version. The command and arguments are fixed
// constants; no user-controlled shell or environment is involved.
type ToolchainProbe struct {
	LookPath func(string) (string, error)
	Command  func(context.Context, string, ...string) *exec.Cmd
}

func (p ToolchainProbe) Status(ctx context.Context) models.ToolchainStatus {
	lookPath := p.LookPath
	if lookPath == nil {
		lookPath = exec.LookPath
	}
	path, err := lookPath("liapoldus")
	if err != nil {
		return models.ToolchainStatus{ErrorCode: "cli.unavailable"}
	}
	status := models.ToolchainStatus{CLIAvailable: true, CLIPath: path}
	commandFactory := p.Command
	if commandFactory == nil {
		commandFactory = func(commandContext context.Context, name string, args ...string) *exec.Cmd {
			return exec.CommandContext(commandContext, name, args...)
		}
	}
	command := commandFactory(ctx, path, "version")
	if command == nil {
		status.ErrorCode = "cli.probe"
		return status
	}
	output, err := command.Output()
	if err != nil {
		status.ErrorCode = "cli.version"
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

func min(left, right int) int {
	if left < right {
		return left
	}
	return right
}
