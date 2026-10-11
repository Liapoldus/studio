package models

// ToolchainStatus is a renderer-safe snapshot of the local CLI installation.
// It deliberately contains no environment, credentials or Core endpoint.
type ToolchainStatus struct {
	CLIPath      string `json:"cliPath"`
	CLIVersion   string `json:"cliVersion"`
	ErrorCode    string `json:"errorCode"`
	CLIAvailable bool   `json:"cliAvailable"`
}
