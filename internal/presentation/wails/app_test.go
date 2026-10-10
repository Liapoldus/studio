package wails

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Liapoldus/studio/internal/domain/models"
)

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
