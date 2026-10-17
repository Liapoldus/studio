package wails

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"strconv"
)

type projectSettingsVersionMigration struct {
	CandidateDigest string
	Candidate       []byte
	FromVersion     int
	ToVersion       int
}

// previewProjectSettingsVersionMigration changes only the root schemaVersion
// marker declared by the new schema. It leaves every other JSON value intact;
// the caller stores the exact source bytes before applying the candidate.
func previewProjectSettingsVersionMigration(settingsDocument, candidateSchema []byte) (projectSettingsVersionMigration, bool, error) {
	var settings map[string]json.RawMessage
	if len(settingsDocument) == 0 || len(settingsDocument) > 8<<20 {
		return projectSettingsVersionMigration{}, false, fmt.Errorf("project settings document is invalid")
	}
	if err := json.Unmarshal(settingsDocument, &settings); err != nil || settings == nil {
		return projectSettingsVersionMigration{}, false, fmt.Errorf("project settings document is invalid")
	}
	var schema struct {
		Properties map[string]struct {
			Const json.RawMessage `json:"const"`
		} `json:"properties"`
	}
	if len(candidateSchema) == 0 || len(candidateSchema) > 1<<20 || json.Unmarshal(candidateSchema, &schema) != nil {
		return projectSettingsVersionMigration{}, false, fmt.Errorf("candidate settings schema is invalid")
	}
	versionSchema, ok := schema.Properties["schemaVersion"]
	if !ok || len(versionSchema.Const) == 0 {
		return projectSettingsVersionMigration{}, false, nil
	}
	versionDocument, versionPresent := settings["schemaVersion"]
	if !versionPresent {
		return projectSettingsVersionMigration{}, false, nil
	}
	var currentVersion, targetVersion int
	if err := json.Unmarshal(versionDocument, &currentVersion); err != nil || currentVersion <= 0 {
		return projectSettingsVersionMigration{}, false, fmt.Errorf("project settings schema version is invalid")
	}
	if err := json.Unmarshal(versionSchema.Const, &targetVersion); err != nil || targetVersion <= 0 {
		return projectSettingsVersionMigration{}, false, fmt.Errorf("candidate settings schema version is invalid")
	}
	if currentVersion == targetVersion {
		return projectSettingsVersionMigration{}, false, nil
	}
	settings["schemaVersion"] = json.RawMessage(strconv.Itoa(targetVersion))
	candidate, err := json.Marshal(settings)
	if err != nil {
		return projectSettingsVersionMigration{}, false, fmt.Errorf("candidate settings migration could not be encoded")
	}
	digest := sha256.Sum256(candidate)
	return projectSettingsVersionMigration{
		FromVersion: currentVersion, ToVersion: targetVersion, Candidate: candidate,
		CandidateDigest: fmt.Sprintf("sha256:%x", digest),
	}, true, nil
}
