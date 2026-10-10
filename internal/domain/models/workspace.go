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

// RuntimePlugin is a project-owned runtime plugin instance. Studio never
// loads the plugin executable into the renderer.
type RuntimePlugin struct {
	ID                 string   `json:"id"`
	Name               string   `json:"name"`
	Version            string   `json:"version"`
	ManifestVersion    string   `json:"manifestVersion"`
	ServicePath        string   `json:"servicePath"`
	SettingsPath       string   `json:"settingsPath"`
	SettingsSchemaPath string   `json:"settingsSchemaPath"`
	LinkPaths          []string `json:"linkPaths"`
	ProblemCount       int      `json:"problemCount"`
	Configured         bool     `json:"configured"`
}

// PluginLink is a generic projection of a versioned plugin-to-plugin contract.
// The source JSON remains authoritative and is edited by a schema surface.
type PluginLink struct {
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

type PluginGraph struct {
	Plugins []RuntimePlugin `json:"plugins"`
	Links   []PluginLink    `json:"links"`
}

// Workspace is the read model used by the desktop shell. It contains only
// project-local source metadata; runtime state is imported separately from CLI
// reports.
type Workspace struct {
	Project *Project      `json:"project"`
	Graph   PluginGraph   `json:"graph"`
	Files   []ProjectFile `json:"files"`
	Git     GitStatus     `json:"git"`
}
