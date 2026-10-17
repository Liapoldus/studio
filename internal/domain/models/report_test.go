package models

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestLatestReportSummaryIsProjectScopedAndRedacted(t *testing.T) {
	reports := []Report{
		{
			ProjectID: "demo", ImportedAt: "2026-10-12T10:00:00Z", OperationID: "older",
			Target: "local", CommitSHA: "abc123", Replicas: []ReplicaResult{{ID: "server", State: "ready", Message: "private replica detail"}},
			Traffic: []TrafficRecord{{RequestPayload: json.RawMessage(`{"token":"secret"}`)}},
		},
		{ProjectID: "demo", ImportedAt: "2026-10-12T11:00:00Z", OperationID: "newer", Target: "local", Generation: "42", Replicas: []ReplicaResult{{ID: "server", State: "ready"}, {ID: "echo", State: "ready"}}},
		{ProjectID: "other", ImportedAt: "2026-10-12T12:00:00Z", OperationID: "other-project"},
	}
	summary := LatestReportSummary(reports, "demo")
	if summary == nil || summary.OperationID != "newer" || summary.Generation != "42" || summary.State != "ready" || summary.ReadyReplicas != 2 {
		t.Fatalf("unexpected latest summary: %+v", summary)
	}
	encoded, err := json.Marshal(summary)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "private replica detail") || strings.Contains(string(encoded), "secret") {
		t.Fatalf("renderer summary leaked report payload: %s", encoded)
	}
	if LatestReportSummary(reports, "missing") != nil {
		t.Fatal("summary returned for an unrelated project")
	}
}

func TestLatestReportSummaryAggregatesPartialReplicaReadiness(t *testing.T) {
	summary := LatestReportSummary([]Report{{
		ProjectID: "demo", ImportedAt: "2026-10-12T10:00:00Z",
		Replicas: []ReplicaResult{{State: "ready"}, {State: "starting"}},
	}}, "demo")
	if summary == nil || summary.State != "degraded" || summary.ReadyReplicas != 1 {
		t.Fatalf("unexpected partial readiness summary: %+v", summary)
	}
}
