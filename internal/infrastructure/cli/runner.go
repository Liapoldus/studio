// Package cli implements the process boundary to the standalone liapoldus CLI.
package cli

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/Liapoldus/studio/internal/domain/interfaces"
	"github.com/Liapoldus/studio/internal/domain/models"
)

var (
	ErrCLIUnavailable = errors.New("liapoldus CLI is unavailable")
	ErrCLIProtocol    = errors.New("invalid liapoldus CLI event")
)

type Runner struct {
	CommandFactory func(context.Context, []string) *exec.Cmd
}

var _ interfaces.CLIRunner = Runner{}

func (r Runner) Run(ctx context.Context, request models.CLIRequest) (<-chan models.CLIEvent, error) {
	if err := request.Validate(); err != nil {
		return nil, err
	}
	factory := r.CommandFactory
	if factory == nil {
		if _, err := exec.LookPath("liapoldus"); err != nil {
			return nil, ErrCLIUnavailable
		}
		factory = defaultCommand
	}
	command := factory(ctx, append([]string{}, request.Args...))
	if command == nil {
		return nil, ErrCLIUnavailable
	}
	command.Dir = request.WorkingDir
	if command.Dir == "" {
		command.Dir = filepath.Clean(request.ProjectRoot)
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		return nil, err
	}
	stderr, err := command.StderrPipe()
	if err != nil {
		return nil, err
	}
	if err := command.Start(); err != nil {
		return nil, fmt.Errorf("start liapoldus: %w", err)
	}
	events := make(chan models.CLIEvent)
	go stream(ctx, command, stdout, stderr, events)
	return events, nil
}

func defaultCommand(ctx context.Context, args []string) *exec.Cmd {
	return exec.CommandContext(ctx, "liapoldus", args...)
}

func stream(ctx context.Context, command *exec.Cmd, stdout io.ReadCloser, stderr io.ReadCloser, events chan<- models.CLIEvent) {
	defer close(events)
	cancelDone := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			// Closing both pipes unblocks scanners even when a platform runtime
			// delays delivery of the child-process termination notification.
			discardError(stdout.Close())
			discardError(stderr.Close())
		case <-cancelDone:
		}
	}()
	defer close(cancelDone)
	defer func() {
		discardError(stdout.Close())
	}()
	defer func() {
		discardError(stderr.Close())
	}()
	stderrDone := make(chan struct {
		message string
	}, 1)
	go func() {
		data, readErr := io.ReadAll(io.LimitReader(stderr, 256*1024))
		if readErr != nil {
			stderrDone <- struct{ message string }{}
			return
		}
		stderrDone <- struct{ message string }{message: strings.TrimSpace(string(data))}
	}()
	scanner := bufio.NewScanner(stdout)
	buffer := make([]byte, 64*1024)
	scanner.Buffer(buffer, 1024*1024)
	for scanner.Scan() {
		var event models.CLIEvent
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil || !event.Valid() {
			emit(ctx, events, models.CLIEvent{SchemaVersion: "cli-events/v1", Type: "diagnostic", Severity: "error", Code: "cli.protocol", Message: ErrCLIProtocol.Error()})
			continue
		}
		emit(ctx, events, event)
	}
	if err := scanner.Err(); err != nil {
		emit(ctx, events, models.CLIEvent{SchemaVersion: "cli-events/v1", Type: "diagnostic", Severity: "error", Code: "cli.stdout", Message: err.Error()})
	}
	stderrResult := <-stderrDone
	if stderrResult.message != "" {
		// Do not forward arbitrary stderr to the renderer. A future CLI report
		// can carry a schema-redacted diagnostic when the message is user-safe.
		emit(ctx, events, models.CLIEvent{SchemaVersion: "cli-events/v1", Type: "diagnostic", Severity: "warning", Code: "cli.stderr", Message: "liapoldus emitted stderr"})
	}
	err := command.Wait()
	if err != nil {
		code := 1
		var exitError *exec.ExitError
		if errors.As(err, &exitError) {
			code = exitError.ExitCode()
		}
		emit(ctx, events, models.CLIEvent{SchemaVersion: "cli-events/v1", Type: "run.failed", Severity: "error", Code: "cli.exit", Message: "liapoldus exited with an error", ExitCode: code})
		return
	}
	emit(ctx, events, models.CLIEvent{SchemaVersion: "cli-events/v1", Type: "run.completed", ExitCode: 0})
}

func emit(ctx context.Context, events chan<- models.CLIEvent, event models.CLIEvent) {
	select {
	case events <- event:
	case <-ctx.Done():
	}
}

func discardError(err error) { _ = err }
