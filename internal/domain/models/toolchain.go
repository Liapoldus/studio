package models

// ToolchainStatus is a renderer-safe snapshot of the local CLI installation.
// It deliberately contains no environment, credentials or Core endpoint.
type ToolchainStatus struct {
	CLIAvailable bool   `json:"cliAvailable"`
	CLIPath      string `json:"cliPath,omitempty"`
	CLIVersion   string `json:"cliVersion,omitempty"`
	ErrorCode    string `json:"errorCode,omitempty"`
}
