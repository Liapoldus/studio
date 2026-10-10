package models

// Diagnostic is a renderer-safe, recoverable record of a failed desktop
// operation. It deliberately contains no process output, credentials or raw
// filesystem paths.
type Diagnostic struct {
	SchemaVersion string `json:"schemaVersion"`
	Timestamp     string `json:"timestamp"`
	Owner         string `json:"owner"`
	Code          string `json:"code"`
	Severity      string `json:"severity"`
	Message       string `json:"message"`
	OperationID   string `json:"operationId"`
	Target        string `json:"target"`
}
