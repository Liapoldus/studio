package models

// ProjectFile is a source file visible in the project navigator. Paths are
// always relative to Project.RootPath and use slash separators in the API.
type ProjectFile struct {
	Path  string `json:"path"`
	Kind  string `json:"kind"`
	Bytes int64  `json:"bytes"`
}

type GitChange struct {
	Path           string `json:"path"`
	IndexStatus    string `json:"indexStatus"`
	WorktreeStatus string `json:"worktreeStatus"`
}

type GitStatus struct {
	Branch    string      `json:"branch"`
	Revision  string      `json:"revision"`
	Changes   []GitChange `json:"changes"`
	Dirty     bool        `json:"dirty"`
	Available bool        `json:"available"`
	Conflict  bool        `json:"conflict"`
}

type GitDiff struct {
	Path      string `json:"path"`
	Patch     string `json:"patch"`
	Truncated bool   `json:"truncated"`
}

type GitConflictSide struct {
	Content   string `json:"content"`
	Available bool   `json:"available"`
	Truncated bool   `json:"truncated"`
}

type GitConflict struct {
	Path   string          `json:"path"`
	Base   GitConflictSide `json:"base"`
	Ours   GitConflictSide `json:"ours"`
	Theirs GitConflictSide `json:"theirs"`
}

type GitStash struct {
	Ref       string `json:"ref"`
	Message   string `json:"message"`
	CreatedAt string `json:"createdAt"`
}

type GitBranch struct {
	Name    string `json:"name"`
	Remote  string `json:"remote"`
	Current bool   `json:"current"`
}

type GitCommit struct {
	Hash      string `json:"hash"`
	ShortHash string `json:"shortHash"`
	Author    string `json:"author"`
	Timestamp string `json:"timestamp"`
	Subject   string `json:"subject"`
}

type GitRemote struct {
	Name     string `json:"name"`
	FetchURL string `json:"fetchUrl"`
	PushURL  string `json:"pushUrl"`
}

// RuntimeService is a project-owned runtime service instance. Studio never
// loads the service executable into the renderer.
//
//nolint:govet // Field order is a reviewed JSON/Wails contract; keep generated bindings stable.
type RuntimeService struct {
	ID                 string                    `json:"id"`
	Name               string                    `json:"name"`
	Version            string                    `json:"version"`
	ManifestVersion    string                    `json:"manifestVersion"`
	ServicePath        string                    `json:"servicePath"`
	SettingsPath       string                    `json:"settingsPath"`
	SettingsSchemaPath string                    `json:"settingsSchemaPath"`
	LinkPaths          []string                  `json:"linkPaths"`
	ProblemCount       int                       `json:"problemCount"`
	Configured         bool                      `json:"configured"`
	Artifact           *ServiceArtifactReference `json:"artifact,omitempty"`
}

// ServiceArtifactReference is the non-secret, project-owned identity of an
// already-built service binary. Local paths and trust decisions stay in the
// CLI-owned artifact registry.
type ServiceArtifactReference struct {
	ID       string `json:"id"`
	Version  string `json:"version"`
	Platform string `json:"platform"`
	Digest   string `json:"digest"`
}

type ServiceArtifactInput struct {
	ID       string `json:"id"`
	Version  string `json:"version"`
	Platform string `json:"platform"`
	Digest   string `json:"digest"`
}

// ServiceLink is a generic projection of a versioned service-to-service contract.
// The source JSON remains authoritative and is edited by a schema surface.
type ServiceLink struct {
	ResponseSchemaPath string   `json:"responseSchemaPath"`
	Target             string   `json:"target"`
	ContractVersion    string   `json:"contractVersion"`
	Transport          string   `json:"transport"`
	SourcePath         string   `json:"sourcePath"`
	RequestSchemaPath  string   `json:"requestSchemaPath"`
	ContractSchemaPath string   `json:"contractSchemaPath"`
	Caller             string   `json:"caller"`
	ID                 string   `json:"id"`
	SecurityProfile    string   `json:"securityProfile"`
	RedactionPolicy    string   `json:"redactionPolicy"`
	Compatibility      string   `json:"compatibility"`
	DisabledMethods    []string `json:"disabledMethods"`
	Methods            []string `json:"methods"`
	TimeoutMillis      int64    `json:"timeoutMillis"`
	ResponseLimitBytes int64    `json:"responseLimitBytes"`
	RequestLimitBytes  int64    `json:"requestLimitBytes"`
	RetryLimit         int      `json:"retryLimit"`
	Valid              bool     `json:"valid"`
}

type ServiceGraph struct {
	Services []RuntimeService `json:"services"`
	Links    []ServiceLink    `json:"links"`
}

type RuntimeServiceInput struct {
	ID                 string `json:"id"`
	Name               string `json:"name"`
	Version            string `json:"version"`
	ManifestVersion    string `json:"manifestVersion"`
	SettingsSchemaPath string `json:"settingsSchemaPath"`
}

//nolint:govet // field order mirrors the versioned JSON contract.
type ServiceLinkInput struct {
	ID                 string   `json:"id"`
	Caller             string   `json:"caller"`
	Target             string   `json:"target"`
	ContractVersion    string   `json:"contractVersion"`
	Methods            []string `json:"methods"`
	Transport          string   `json:"transport"`
	RequestSchemaPath  string   `json:"requestSchemaPath"`
	ResponseSchemaPath string   `json:"responseSchemaPath"`
	ContractSchemaPath string   `json:"contractSchemaPath"`
	SecurityProfile    string   `json:"securityProfile"`
	TimeoutMillis      int64    `json:"timeoutMillis"`
	RetryLimit         int      `json:"retryLimit"`
	RequestLimitBytes  int64    `json:"requestLimitBytes"`
	ResponseLimitBytes int64    `json:"responseLimitBytes"`
	DisabledMethods    []string `json:"disabledMethods"`
	Compatibility      string   `json:"compatibility"`
	RedactionPolicy    string   `json:"redactionPolicy"`
}

// Workspace is the read model used by the desktop shell. It contains only
// project-local source metadata; runtime state is imported separately from CLI
// reports.
type Workspace struct {
	Project *Project      `json:"project"`
	Graph   ServiceGraph  `json:"graph"`
	Files   []ProjectFile `json:"files"`
	Git     GitStatus     `json:"git"`
}
