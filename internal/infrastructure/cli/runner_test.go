package cli

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/Liapoldus/studio/internal/domain/models"
)

func TestRunnerParsesJSONLEventsAndExit(t *testing.T) {
	request := models.CLIRequest{ProjectRoot: t.TempDir(), Args: []string{"validate"}}
	runner := Runner{CommandFactory: func(ctx context.Context, args []string) *exec.Cmd {
		return &exec.Cmd{Path: os.Args[0], Args: append([]string{os.Args[0], "-test.run=TestCLIHelperProcess", "--"}, args...)}
	}}
	t.Setenv("STUDIO_CLI_HELPER", "1")
	events, err := runner.Run(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	var values []models.CLIEvent
	for event := range events {
		values = append(values, event)
	}
	if len(values) != 3 || values[0].Type != "run.started" || values[1].Type != "run.progress" || values[2].Type != "run.completed" {
		t.Fatalf("events: %+v", values)
	}
	if values[1].Percent != 50 || values[2].ExitCode != 0 {
		t.Fatalf("event fields: %+v", values)
	}
}

func TestRunnerPreservesActionableFailureWithoutDuplicatingTerminalEvent(t *testing.T) {
	request := models.CLIRequest{ProjectRoot: t.TempDir(), Args: []string{"validate"}}
	runner := Runner{CommandFactory: func(_ context.Context, args []string) *exec.Cmd {
		return &exec.Cmd{Path: os.Args[0], Args: append([]string{os.Args[0], "-test.run=TestCLIFailureHelperProcess", "--"}, args...)}
	}}
	t.Setenv("STUDIO_CLI_FAILURE_HELPER", "1")
	events, err := runner.Run(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	var values []models.CLIEvent
	for event := range events {
		values = append(values, event)
	}
	if len(values) != 2 || values[0].Type != "diagnostic" || values[1].Type != "run.failed" {
		t.Fatalf("expected one diagnostic and one terminal failure, got %+v", values)
	}
	if values[1].Code != "docker_mount_source_unavailable" || values[1].Message != "Core state mount source is unavailable: [redacted path]" {
		t.Fatalf("terminal event lost actionable safe diagnostic: %+v", values[1])
	}
}

func TestRunnerRejectsInvalidRequest(t *testing.T) {
	if _, err := (Runner{}).Run(context.Background(), models.CLIRequest{ProjectRoot: "relative", Args: []string{"validate"}}); !errors.Is(err, models.ErrInvalidCLIRequest) {
		t.Fatalf("expected invalid request, got %v", err)
	}
	if _, err := (Runner{}).Run(context.Background(), models.CLIRequest{ProjectRoot: t.TempDir(), Args: []string{"apply", "--token=secret"}}); !errors.Is(err, models.ErrInvalidCLIRequest) {
		t.Fatalf("expected credential argument rejection, got %v", err)
	}
}

func TestRunnerSendsServiceSecretOnlyOnStdinAndClearsMemoryAfterward(t *testing.T) {
	root := t.TempDir()
	secret := []byte("host-owned-sensitive-value")
	request := models.CLIRequest{
		ProjectRoot: root,
		Args:        []string{"service", "secret", "create", "--target", "local", "--service", "server", "--purpose", "http.auth.bearer", "--label", "edge token", "--secret-stdin", "--confirm"},
		SecretInput: secret,
	}
	runner := Runner{CommandFactory: func(ctx context.Context, args []string) *exec.Cmd {
		if strings.Contains(strings.Join(args, " "), string(secret)) {
			t.Fatal("secret value was passed in CLI argv")
		}
		return exec.CommandContext(ctx, os.Args[0], append([]string{"-test.run=TestCLISecretInputHelperProcess", "--"}, args...)...) //nolint:gosec // test helper reads stdin and verifies redaction.
	}}
	t.Setenv("STUDIO_CLI_SECRET_INPUT_HELPER", "1")
	events, err := runner.Run(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	var values []models.CLIEvent
	for event := range events {
		values = append(values, event)
	}
	if len(values) != 2 || values[0].Type != "run.started" || values[1].Type != "run.completed" {
		t.Fatalf("secret helper did not complete with safe events: %+v", values)
	}
	if !bytes.Equal(secret, make([]byte, len(secret))) {
		t.Fatal("CLI runner retained the host secret buffer after process completion")
	}
}

func TestRunnerStopsChildWhenContextIsCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runner := Runner{CommandFactory: func(_ context.Context, args []string) *exec.Cmd {
		return exec.CommandContext(ctx, os.Args[0], append([]string{"-test.run=TestCLICancelHelperProcess", "--"}, args...)...) //nolint:gosec // test helper runs the current test binary.
	}}
	t.Setenv("STUDIO_CLI_CANCEL_HELPER", "1")
	events, err := runner.Run(ctx, models.CLIRequest{ProjectRoot: t.TempDir(), Args: []string{"operation", "watch", "operation-1", "--target", "local"}})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-events:
	case <-time.After(time.Second):
		t.Fatal("CLI helper did not start")
	}
	cancel()
	select {
	case _, ok := <-events:
		for ok {
			_, ok = <-events
		}
	case <-time.After(3 * time.Second):
		t.Fatal("CLI runner did not close after cancellation")
	}
}

func TestCLIHelperProcess(t *testing.T) {
	if os.Getenv("STUDIO_CLI_HELPER") != "1" {
		return
	}
	if _, err := os.Stdout.WriteString(`{"schemaVersion":"cli-events/v1","type":"run.started"}` + "\n"); err != nil {
		os.Exit(1)
	}
	if _, err := os.Stdout.WriteString(`{"schemaVersion":"cli-events/v1","type":"run.progress","percent":50}` + "\n"); err != nil {
		os.Exit(1)
	}
	if strings.Contains(strings.Join(os.Args, " "), "secret") {
		os.Exit(1)
	}
	os.Exit(0)
}

func TestCLIFailureHelperProcess(t *testing.T) {
	if os.Getenv("STUDIO_CLI_FAILURE_HELPER") != "1" {
		return
	}
	if _, err := os.Stdout.WriteString(`{"schemaVersion":"cli-events/v1","type":"diagnostic","severity":"error","code":"docker_mount_source_unavailable","message":"Core state mount source is unavailable: [redacted path]"}` + "\n"); err != nil {
		os.Exit(1)
	}
	if _, err := os.Stdout.WriteString(`{"schemaVersion":"cli-events/v1","type":"run.failed","severity":"error","exitCode":5}` + "\n"); err != nil {
		os.Exit(1)
	}
	os.Exit(5)
}

func TestCLISecretInputHelperProcess(t *testing.T) {
	if os.Getenv("STUDIO_CLI_SECRET_INPUT_HELPER") != "1" {
		return
	}
	input, err := io.ReadAll(os.Stdin)
	if err != nil || string(input) != "host-owned-sensitive-value" {
		os.Exit(1)
	}
	clear(input)
	if _, err := os.Stdout.WriteString(`{"schemaVersion":"cli-events/v1","type":"run.started"}` + "\n"); err != nil {
		os.Exit(1)
	}
	if _, err := os.Stdout.WriteString(`{"schemaVersion":"cli-events/v1","type":"run.completed"}` + "\n"); err != nil {
		os.Exit(1)
	}
	os.Exit(0)
}

func TestCLICancelHelperProcess(t *testing.T) {
	if os.Getenv("STUDIO_CLI_CANCEL_HELPER") != "1" {
		return
	}
	if _, err := os.Stdout.WriteString(`{"schemaVersion":"cli-events/v1","type":"run.started"}` + "\n"); err != nil {
		os.Exit(1)
	}
	time.Sleep(30 * time.Second)
	os.Exit(0)
}
