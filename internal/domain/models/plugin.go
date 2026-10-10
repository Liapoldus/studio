package models

import "errors"

var (
	ErrInvalidStudioPlugin        = errors.New("invalid Studio plugin package")
	ErrPermissionApprovalRequired = errors.New("required Studio plugin permissions were not approved")
)

type PluginSurface struct {
	ID     string `json:"id"`
	Kind   string `json:"kind"`
	Title  string `json:"title"`
	Route  string `json:"route,omitempty"`
	Schema string `json:"schema,omitempty"`
	ToolID string `json:"toolId,omitempty"`
}

type PluginArtifact struct {
	Platform string `json:"platform"`
	Path     string `json:"path"`
	Digest   string `json:"digest"`
}

type CompanionTool struct {
	Artifacts     []PluginArtifact `json:"artifacts,omitempty"`
	Permissions   map[string]any   `json:"permissions,omitempty"`
	Environment   []string         `json:"environment,omitempty"`
	ID            string           `json:"id"`
	Version       string           `json:"version"`
	Executable    string           `json:"executable"`
	Platforms     []string         `json:"platforms"`
	TimeoutMillis int64            `json:"timeoutMillis,omitempty"`
}

type PluginProcess struct {
	Artifacts     []PluginArtifact `json:"artifacts,omitempty"`
	Environment   []string         `json:"environment,omitempty"`
	Executable    string           `json:"executable"`
	Platforms     []string         `json:"platforms"`
	TimeoutMillis int64            `json:"timeoutMillis,omitempty"`
}

type StudioPluginManifest struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Version     string          `json:"version"`
	StudioRange string          `json:"studioRange"`
	Signature   string          `json:"signature,omitempty"`
	Process     *PluginProcess  `json:"process,omitempty"`
	Surfaces    []PluginSurface `json:"surfaces"`
	Tools       []CompanionTool `json:"tools"`
	Permissions []string        `json:"permissions"`
}

//nolint:govet // wire-model field order follows the public JSON contract.
type PluginProcessStatus struct {
	PluginID  string `json:"pluginId"`
	Version   string `json:"version"`
	State     string `json:"state"`
	ErrorCode string `json:"errorCode,omitempty"`
	Sandboxed bool   `json:"sandboxed"`
	Warning   string `json:"warning,omitempty"`
}

type PluginInspection struct {
	Manifest           StudioPluginManifest `json:"manifest"`
	Digest             string               `json:"digest"`
	Files              []string             `json:"files"`
	GrantedPermissions []string             `json:"grantedPermissions,omitempty"`
	Signed             bool                 `json:"signed"`
}

type TrustDecision struct {
	Reason             string
	GrantedPermissions []string
	Approved           bool
}

type InstalledPlugin struct {
	Digest   string               `json:"digest"`
	Path     string               `json:"path"`
	Manifest StudioPluginManifest `json:"manifest"`
}

type ToolExecutionRequest struct {
	PluginPath  string
	ProjectRoot string
	WorkingDir  string
	ToolID      string
	Digest      string
	Args        []string
	Manifest    StudioPluginManifest
}

//nolint:govet // wire-model field order follows the public JSON contract.
type ToolExecutionResult struct {
	ToolID    string `json:"toolId"`
	Version   string `json:"version"`
	Digest    string `json:"digest"`
	Stdout    string `json:"stdout"`
	Stderr    string `json:"stderr"`
	ExitCode  int    `json:"exitCode"`
	Truncated bool   `json:"truncated"`
	TimedOut  bool   `json:"timedOut"`
	Sandboxed bool   `json:"sandboxed"`
	Warning   string `json:"warning,omitempty"`
}
