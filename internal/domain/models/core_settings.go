package models

// CoreSettingsView is the redacted, typed subset of Core's settings snapshot
// that the Studio renderer may display. File references and credential data
// are intentionally absent from this model.
//
//nolint:govet // Field order follows the versioned CLI JSON contract.
type CoreSettingsView struct {
	Settings          CoreSettingsValues `json:"settings"`
	SchemaVersion     string             `json:"schemaVersion"`
	Target            string             `json:"target"`
	DesiredRevision   uint64             `json:"desiredRevision"`
	EffectiveRevision uint64             `json:"effectiveRevision"`
	Pending           bool               `json:"pending"`
	RestartRequired   bool               `json:"restartRequired"`
}

type CoreSettingsValues struct {
	Management CoreManagementSettings `json:"management"`
}

type CoreManagementSettings struct {
	Listen         string `json:"listen"`
	HeaderTimeout  string `json:"headerTimeout"`
	RequestTimeout string `json:"requestTimeout"`
	MaxBodyBytes   int64  `json:"maxBodyBytes"`
}
