package models

import "encoding/json"

type ReplicaResult struct {
	ID      string `json:"id"`
	State   string `json:"state"`
	Message string `json:"message,omitempty"`
}

type TrafficRecord struct {
	Method           string          `json:"method"`
	Timestamp        string          `json:"timestamp"`
	CorrelationID    string          `json:"correlationId"`
	Caller           string          `json:"caller"`
	Target           string          `json:"target"`
	Transport        string          `json:"transport"`
	Status           string          `json:"status"`
	SchemaValidation string          `json:"schemaValidation"`
	ResponsePayload  json.RawMessage `json:"responsePayload,omitempty"`
	RequestPayload   json.RawMessage `json:"requestPayload,omitempty"`
	LatencyMillis    int64           `json:"latencyMillis"`
	RequestSize      int64           `json:"requestSize"`
	ResponseSize     int64           `json:"responseSize"`
}

// TrafficRecordView is the renderer-safe projection of an observation. Payloads
// have already passed report redaction and are exposed as text rather than
// arbitrary JSON values to keep the Wails boundary narrow.
type TrafficRecordView struct {
	ReportOperationID string `json:"reportOperationId"`
	ReportTarget      string `json:"reportTarget"`
	ReportCommitSHA   string `json:"reportCommitSha"`
	Timestamp         string `json:"timestamp"`
	CorrelationID     string `json:"correlationId"`
	Caller            string `json:"caller"`
	Target            string `json:"target"`
	Method            string `json:"method"`
	Transport         string `json:"transport"`
	Status            string `json:"status"`
	SchemaValidation  string `json:"schemaValidation"`
	RequestPayload    string `json:"requestPayload"`
	ResponsePayload   string `json:"responsePayload"`
	LatencyMillis     int64  `json:"latencyMillis"`
	RequestSize       int64  `json:"requestSize"`
	ResponseSize      int64  `json:"responseSize"`
}

type Report struct {
	SchemaVersion          string          `json:"schemaVersion"`
	ImportedAt             string          `json:"importedAt,omitempty"`
	ProjectID              string          `json:"projectId"`
	Repository             string          `json:"repository"`
	CommitSHA              string          `json:"commitSha"`
	Target                 string          `json:"target"`
	BundleDigest           string          `json:"bundleDigest"`
	CLIVersion             string          `json:"cliVersion"`
	CoreAPICompatibility   string          `json:"coreApiCompatibility"`
	OperationID            string          `json:"operationId"`
	Generation             string          `json:"generation"`
	TrafficReportReference string          `json:"trafficReportReference,omitempty"`
	Replicas               []ReplicaResult `json:"replicas,omitempty"`
	Traffic                []TrafficRecord `json:"traffic,omitempty"`
}

// ReportSummary is a renderer-safe projection for the workspace Inspector. It
// intentionally excludes replica messages and all request/response payloads.
type ReportSummary struct {
	OperationID          string `json:"operationId"`
	Target               string `json:"target"`
	CommitSHA            string `json:"commitSha"`
	Generation           string `json:"generation"`
	BundleDigest         string `json:"bundleDigest"`
	CLIVersion           string `json:"cliVersion"`
	CoreAPICompatibility string `json:"coreApiCompatibility"`
	ImportedAt           string `json:"importedAt"`
	State                string `json:"state"`
	ReplicaCount         int    `json:"replicaCount"`
	ReadyReplicas        int    `json:"readyReplicas"`
}

func LatestReportSummary(reports []Report, projectID string) *ReportSummary {
	var latest *Report
	for index := range reports {
		report := &reports[index]
		if report.ProjectID != projectID || report.ImportedAt == "" {
			continue
		}
		if latest == nil || report.ImportedAt > latest.ImportedAt || report.ImportedAt == latest.ImportedAt && report.OperationID > latest.OperationID {
			latest = report
		}
	}
	if latest == nil {
		return nil
	}
	summary := &ReportSummary{
		OperationID: latest.OperationID, Target: latest.Target, CommitSHA: latest.CommitSHA,
		Generation: latest.Generation, BundleDigest: latest.BundleDigest, CLIVersion: latest.CLIVersion,
		CoreAPICompatibility: latest.CoreAPICompatibility, ImportedAt: latest.ImportedAt,
		ReplicaCount: len(latest.Replicas), State: "unknown",
	}
	for _, replica := range latest.Replicas {
		if replica.State == "ready" {
			summary.ReadyReplicas++
		}
	}
	if summary.ReplicaCount > 0 {
		summary.State = "not-ready"
		if summary.ReadyReplicas == summary.ReplicaCount {
			summary.State = "ready"
		} else if summary.ReadyReplicas > 0 {
			summary.State = "degraded"
		}
	}
	return summary
}
