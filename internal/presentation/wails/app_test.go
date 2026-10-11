package wails

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Liapoldus/studio/internal/domain/models"
)

type diagnosticStoreStub struct {
	items []models.Diagnostic
}

func (s *diagnosticStoreStub) Append(_ context.Context, _ string, diagnostic models.Diagnostic) error {
	s.items = append(s.items, diagnostic)
	return nil
}

func (s *diagnosticStoreStub) List(context.Context, string) ([]models.Diagnostic, error) {
	return s.items, nil
}

func TestStructuredCLIResultUsesSafeDiagnosticWhenOutputIsMissing(t *testing.T) {
	events := make(chan models.CLIEvent, 2)
	events <- models.CLIEvent{Type: "diagnostic", Severity: "error", Code: "cli.protocol", Message: "invalid liapoldus CLI event"}
	events <- models.CLIEvent{Type: "run.completed"}
	close(events)

	if _, err := structuredCLIResult(events); err == nil || err.Error() != "liapoldus: cli.protocol: invalid liapoldus CLI event" {
		t.Fatalf("expected actionable safe diagnostic, got %v", err)
	}
}

func TestStructuredCLIResultReturnsRunOutput(t *testing.T) {
	events := make(chan models.CLIEvent, 2)
	events <- models.CLIEvent{Type: "run.output", Payload: []byte(`{"registered":true}`)}
	events <- models.CLIEvent{Type: "run.completed"}
	close(events)

	result, err := structuredCLIResult(events)
	if err != nil || string(result) != `{"registered":true}` {
		t.Fatalf("unexpected structured result %s: %v", result, err)
	}
}

func TestPluginProcessFailureDiagnosticIsDeduplicatedUntilRestart(t *testing.T) {
	store := &diagnosticStoreStub{}
	app := &App{diagnostics: store}

	app.recordPluginProcessFailure(t.TempDir(), "example.plugin", "1.0.0", "process.exit")
	app.recordPluginProcessFailure(t.TempDir(), "example.plugin", "1.0.0", "process.exit")
	if len(store.items) != 1 {
		t.Fatalf("expected one diagnostic for repeated status polling, got %d", len(store.items))
	}

	app.clearPluginProcessDiagnostic("example.plugin", "1.0.0")
	app.recordPluginProcessFailure(t.TempDir(), "example.plugin", "1.0.0", "process.exit")
	if len(store.items) != 2 {
		t.Fatalf("expected a new diagnostic after restart, got %d", len(store.items))
	}
}

func TestTrafficViewsAreRedactedAndKeepProvenance(t *testing.T) {
	views, err := trafficViews([]models.Report{{
		OperationID: "operation-1",
		Target:      "local",
		CommitSHA:   "abc123",
		Traffic: []models.TrafficRecord{{
			Caller:          "runtime",
			Target:          "orders",
			Method:          "List",
			RequestPayload:  []byte(`{"token":"secret","query":"safe"}`),
			ResponsePayload: []byte(`{"authorization":"bearer secret","items":[]}`),
		}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if len(views) != 1 || views[0].ReportOperationID != "operation-1" || views[0].ReportTarget != "local" || views[0].ReportCommitSHA != "abc123" {
		t.Fatalf("unexpected provenance: %+v", views)
	}
	if strings.Contains(views[0].RequestPayload, "secret") || strings.Contains(views[0].ResponsePayload, "secret") {
		t.Fatalf("secret leaked into renderer view: %+v", views[0])
	}
	if !strings.Contains(views[0].RequestPayload, "[REDACTED]") {
		t.Fatalf("request was not redacted: %s", views[0].RequestPayload)
	}
}

func TestReadImportedReportAllowsOnlyProjectLocalReportFiles(t *testing.T) {
	root := t.TempDir()
	directory := filepath.Join(root, ".studio", "reports")
	if err := os.MkdirAll(directory, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(directory, "operation.json")
	if err := os.WriteFile(path, []byte(`{"projectId":"p"}`), 0600); err != nil {
		t.Fatal(err)
	}
	if data, err := readImportedReport(root, ".studio/reports/operation.json"); err != nil || string(data) != `{"projectId":"p"}` {
		t.Fatalf("read local report: %s %v", data, err)
	}
	if _, err := readImportedReport(root, ".studio/reports/../secrets.json"); err == nil {
		t.Fatal("accepted report outside reports directory")
	}
}

func TestEditorAssociationMatchesProjectFileBasename(t *testing.T) {
	matched, err := matchesEditorAssociation("*.yaml", "services/runtime/service.yaml")
	if err != nil || !matched {
		t.Fatalf("expected extension association to match basename: %v %v", matched, err)
	}
	matched, err = matchesEditorAssociation("services/*.yaml", "services/runtime/service.yaml")
	if err != nil || matched {
		t.Fatalf("unexpected directory association match: %v %v", matched, err)
	}
	if _, err = matchesEditorAssociation("[", "service.yaml"); err == nil {
		t.Fatal("accepted invalid association pattern")
	}
}
