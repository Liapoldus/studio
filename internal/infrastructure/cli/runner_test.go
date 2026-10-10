package cli

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/Liapoldus/studio/internal/domain/models"
)

func TestRunnerParsesJSONLEventsAndExit(t *testing.T) {
	request := models.CLIRequest{ProjectRoot: t.TempDir(), Args: []string{"validate"}}
	runner := Runner{CommandFactory: func(_ context.Context, args []string) *exec.Cmd {
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

func TestRunnerRejectsInvalidRequest(t *testing.T) {
	if _, err := (Runner{}).Run(context.Background(), models.CLIRequest{ProjectRoot: "relative", Args: []string{"validate"}}); !errors.Is(err, models.ErrInvalidCLIRequest) {
		t.Fatalf("expected invalid request, got %v", err)
	}
	if _, err := (Runner{}).Run(context.Background(), models.CLIRequest{ProjectRoot: t.TempDir(), Args: []string{"apply", "--token=secret"}}); !errors.Is(err, models.ErrInvalidCLIRequest) {
		t.Fatalf("expected credential argument rejection, got %v", err)
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
