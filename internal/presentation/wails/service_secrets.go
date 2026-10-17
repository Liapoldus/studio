package wails

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	cliplan "github.com/Liapoldus/studio/internal/application/cli"
	"github.com/Liapoldus/studio/internal/domain/models"
)

const maxServiceSecretInputBytes = 16 << 10

type serviceSecretCatalog struct {
	SchemaVersion        string                              `json:"schemaVersion"`
	Target               string                              `json:"target"`
	ServiceID            string                              `json:"serviceId"`
	Items                []models.ServiceSecretReference     `json:"items"`
	PendingRotations     []serviceSecretRotationMetadata     `json:"pendingRotations"`
	PendingRegistrations []serviceSecretRegistrationMetadata `json:"pendingRegistrations"`
}

type serviceSecretRotationMetadata struct {
	PreviousReference string `json:"previousReference"`
	CreatedReference  string `json:"createdReference"`
	ServiceID         string `json:"serviceId"`
	Purpose           string `json:"purpose"`
	State             string `json:"state"`
}

type serviceSecretRegistrationMetadata struct {
	Reference string `json:"reference"`
	ServiceID string `json:"serviceId"`
	Purpose   string `json:"purpose"`
	Label     string `json:"label"`
	State     string `json:"state"`
}

type serviceSecretCreateResult struct {
	SchemaVersion string                        `json:"schemaVersion"`
	Target        string                        `json:"target"`
	Item          models.ServiceSecretReference `json:"item"`
}

type serviceSecretRotationResult struct {
	SchemaVersion string                        `json:"schemaVersion"`
	Target        string                        `json:"target"`
	ServiceID     string                        `json:"serviceId"`
	Previous      models.ServiceSecretReference `json:"previous"`
	Created       models.ServiceSecretReference `json:"created"`
	State         string                        `json:"state"`
}

type serviceSecretRegisterResult struct {
	SchemaVersion string                        `json:"schemaVersion"`
	Target        string                        `json:"target"`
	Item          models.ServiceSecretReference `json:"item"`
}

type serviceSecretRevokeResult struct {
	SchemaVersion string `json:"schemaVersion"`
	Target        string `json:"target"`
	ServiceID     string `json:"serviceId"`
	Reference     string `json:"reference"`
	State         string `json:"state"`
}

type serviceSecretPurposeManifest struct {
	ID             string   `json:"id"`
	SecretPurposes []string `json:"secretPurposes"`
}

type serviceSecretRuntimeStatus struct {
	InstanceID string            `json:"instanceId"`
	Replicas   []json.RawMessage `json:"replicas"`
}

// ReadLocalServiceSecretReferences returns the safe reference catalog for a
// service in the currently open Project. Secret values never enter Studio.
func (a *App) ReadLocalServiceSecretReferences(serviceID string) (string, error) {
	workspace, err := a.currentSecretService(serviceID)
	if err != nil {
		return "", err
	}
	payload, err := a.runCLIJSONInWorkspaceWithTimeout(workspace, models.CLIIntent{Command: "service.secret.list", Target: "local", ServiceID: serviceID}, 20*time.Second)
	if err != nil {
		return "", err
	}
	var catalog serviceSecretCatalog
	decodeErr := decodeBoundedJSON(payload, &catalog)
	if decodeErr != nil || catalog.SchemaVersion != "service-secret-references/v1" || catalog.Target != "local" || catalog.ServiceID != serviceID || len(catalog.Items) > 4096 || len(catalog.PendingRotations) > 4096 || len(catalog.PendingRegistrations) > 4096 {
		return "", errors.New("local secret catalog returned an invalid response")
	}
	itemsByReference := make(map[string]models.ServiceSecretReference, len(catalog.Items))
	for _, item := range catalog.Items {
		if !item.ValidFor(serviceID) {
			return "", errors.New("local secret catalog returned invalid metadata")
		}
		if _, exists := itemsByReference[item.Reference]; exists {
			return "", errors.New("local secret catalog returned duplicate metadata")
		}
		itemsByReference[item.Reference] = item
	}
	seenRotations := make(map[string]struct{}, len(catalog.PendingRotations))
	for _, rotation := range catalog.PendingRotations {
		previous, previousExists := itemsByReference[rotation.PreviousReference]
		created, createdExists := itemsByReference[rotation.CreatedReference]
		if rotation.ServiceID != serviceID || !validSecretReference(rotation.PreviousReference) || !validSecretReference(rotation.CreatedReference) ||
			rotation.PreviousReference == rotation.CreatedReference || !validSecretPurpose(rotation.Purpose) || rotation.State != "staged" ||
			!previousExists || !createdExists || previous.State != "active" || created.State != "active" ||
			previous.ServiceID != serviceID || created.ServiceID != serviceID || previous.Purpose != rotation.Purpose || created.Purpose != rotation.Purpose {
			return "", errors.New("local secret catalog returned invalid rotation metadata")
		}
		if _, exists := seenRotations[rotation.CreatedReference]; exists {
			return "", errors.New("local secret catalog returned duplicate rotation metadata")
		}
		seenRotations[rotation.CreatedReference] = struct{}{}
	}
	seenRegistrations := make(map[string]struct{}, len(catalog.PendingRegistrations))
	for _, registration := range catalog.PendingRegistrations {
		if registration.ServiceID != serviceID || !validSecretReference(registration.Reference) || !validSecretPurpose(registration.Purpose) ||
			strings.TrimSpace(registration.Label) == "" || strings.TrimSpace(registration.Label) != registration.Label || len([]rune(registration.Label)) > 128 ||
			strings.ContainsAny(registration.Label, "\x00\r\n") || registration.State != "pending" && registration.State != "conflict" {
			return "", errors.New("local secret catalog returned invalid pending registration metadata")
		}
		if _, exists := seenRegistrations[registration.Reference]; exists {
			return "", errors.New("local secret catalog returned duplicate pending registration metadata")
		}
		seenRegistrations[registration.Reference] = struct{}{}
	}
	if catalog.Items == nil {
		catalog.Items = []models.ServiceSecretReference{}
	}
	if catalog.PendingRotations == nil {
		catalog.PendingRotations = []serviceSecretRotationMetadata{}
	}
	if catalog.PendingRegistrations == nil {
		catalog.PendingRegistrations = []serviceSecretRegistrationMetadata{}
	}
	encoded, err := json.Marshal(catalog)
	if err != nil {
		return "", errors.New("local secret catalog could not be encoded")
	}
	return string(encoded), nil
}

// RegisterLocalServiceSecret retries Core registration for a value that is
// already stored in the OS vault. The secret value never enters Studio.
func (a *App) RegisterLocalServiceSecret(serviceID, reference string, confirmed bool) error {
	if !confirmed || !validSecretReference(reference) {
		return errors.New("local secret registration confirmation is required")
	}
	workspace, err := a.currentSecretService(serviceID)
	if err != nil {
		return err
	}
	payload, err := a.runCLIJSONInWorkspaceWithTimeout(workspace, models.CLIIntent{
		Command: "service.secret.register", Target: "local", ServiceID: serviceID, Reference: reference,
	}, 30*time.Second)
	if err != nil {
		return safeServiceSecretError(err, nil)
	}
	var response serviceSecretRegisterResult
	if err := decodeBoundedJSON(payload, &response); err != nil || response.SchemaVersion != "service-secret-register-result/v1" ||
		response.Target != "local" || !response.Item.ValidFor(serviceID) || response.Item.Reference != reference {
		return errors.New("local secret registration returned invalid metadata")
	}
	return nil
}

// CreateLocalServiceSecret uses the host-owned CLI stdin channel. Callers must
// explicitly confirm because the value is persisted in the local OS vault.
func (a *App) CreateLocalServiceSecret(serviceID, purpose, label string, secret []byte, confirmed bool) (result string, resultErr error) {
	defer clear(secret)
	if !confirmed || len(secret) == 0 || len(secret) > maxServiceSecretInputBytes || bytes.IndexByte(secret, 0) >= 0 {
		return "", errors.New("secret input is invalid or confirmation is missing")
	}
	workspace, err := a.currentSecretService(serviceID)
	if err != nil {
		return "", err
	}
	declared, err := a.declaredSecretPurpose(workspace, serviceID, purpose)
	if err != nil {
		return "", err
	}
	if !declared {
		return "", errors.New("service did not declare this secret purpose")
	}
	argsIntent := models.CLIIntent{Command: "service.secret.create", Target: "local", ServiceID: serviceID, Purpose: purpose, Label: label}
	args, err := planCLIIntent(argsIntent, workspace.Project.RootPath)
	if err != nil {
		return "", err
	}
	input := append([]byte(nil), secret...)
	defer clear(input)
	payload, err := a.runCLIRequestJSONWithTimeout(workspace, models.CLIRequest{ProjectRoot: workspace.Project.RootPath, WorkingDir: workspace.Project.RootPath, Args: args, SecretInput: input}, 30*time.Second)
	if err != nil {
		return "", safeServiceSecretError(err, secret)
	}
	var response serviceSecretCreateResult
	decodeErr := decodeBoundedJSON(payload, &response)
	if decodeErr != nil || response.SchemaVersion != "service-secret-create-result/v1" || response.Target != "local" || !response.Item.ValidFor(serviceID) || response.Item.Purpose != purpose {
		return "", errors.New("local secret create returned an invalid response")
	}
	encoded, err := json.Marshal(response)
	if err != nil {
		return "", errors.New("local secret create response could not be encoded")
	}
	return string(encoded), nil
}

// RotateLocalServiceSecret creates a replacement reference and deliberately
// leaves the old reference active. The user must update and apply Project
// settings before the old reference can pass the guarded revoke operation.
func (a *App) RotateLocalServiceSecret(serviceID, reference, purpose, label string, secret []byte, confirmed bool) (result string, resultErr error) {
	defer clear(secret)
	if !confirmed || !validSecretReference(reference) || len(secret) == 0 || len(secret) > maxServiceSecretInputBytes || bytes.IndexByte(secret, 0) >= 0 {
		return "", errors.New("secret rotation input is invalid or confirmation is missing")
	}
	workspace, err := a.currentSecretService(serviceID)
	if err != nil {
		return "", err
	}
	declared, err := a.declaredSecretPurpose(workspace, serviceID, purpose)
	if err != nil {
		return "", err
	}
	if !declared {
		return "", errors.New("service did not declare this secret purpose")
	}
	catalogJSON, err := a.ReadLocalServiceSecretReferences(serviceID)
	if err != nil {
		return "", err
	}
	var catalog serviceSecretCatalog
	if err = decodeBoundedJSON([]byte(catalogJSON), &catalog); err != nil {
		return "", errors.New("local secret catalog returned invalid metadata")
	}
	var previous *models.ServiceSecretReference
	for index := range catalog.Items {
		item := &catalog.Items[index]
		if item.Reference == reference {
			previous = item
			break
		}
	}
	if previous == nil || previous.State != "active" || previous.ServiceID != serviceID || previous.Purpose != purpose || !previous.ValidFor(serviceID) {
		return "", errors.New("secret rotation source is not active for this service and purpose")
	}
	intent := models.CLIIntent{Command: "service.secret.rotate", Target: "local", ServiceID: serviceID, Reference: reference, Purpose: purpose, Label: label}
	args, err := planCLIIntent(intent, workspace.Project.RootPath)
	if err != nil {
		return "", err
	}
	input := append([]byte(nil), secret...)
	defer clear(input)
	payload, err := a.runCLIRequestJSONWithTimeout(workspace, models.CLIRequest{ProjectRoot: workspace.Project.RootPath, WorkingDir: workspace.Project.RootPath, Args: args, SecretInput: input}, 30*time.Second)
	if err != nil {
		return "", safeServiceSecretError(err, secret)
	}
	var response serviceSecretRotationResult
	if err = decodeBoundedJSON(payload, &response); err != nil || response.SchemaVersion != "service-secret-rotation-result/v1" || response.Target != "local" ||
		response.ServiceID != serviceID || response.Previous.Reference != reference || response.Previous.Purpose != purpose || response.Previous.State != "active" ||
		!response.Previous.ValidFor(serviceID) || response.Created.Reference == reference || response.Created.Purpose != purpose || response.Created.State != "active" ||
		!response.Created.ValidFor(serviceID) || response.State != "staged" {
		return "", errors.New("local secret rotation returned invalid metadata")
	}
	encoded, err := json.Marshal(response)
	if err != nil {
		return "", errors.New("local secret rotation response could not be encoded")
	}
	return string(encoded), nil
}

func safeServiceSecretError(err error, secret []byte) error {
	if err == nil {
		return nil
	}
	message := err.Error()
	value := string(secret)
	if len(secret) >= 8 && strings.ToValidUTF8(value, "") == value {
		message = strings.ReplaceAll(message, value, "[redacted]")
	} else {
		message = "liapoldus could not store the local service secret"
	}
	return errors.New(safeCLIText(message))
}

// RevokeLocalServiceSecret explicitly revokes a service-bound reference after
// confirmation; the CLI also removes its local vault material.
func (a *App) RevokeLocalServiceSecret(serviceID, reference string, confirmed bool) error {
	if !confirmed || !validSecretReference(reference) {
		return errors.New("secret revocation requires confirmation")
	}
	workspace, err := a.currentSecretService(serviceID)
	if err != nil {
		return err
	}
	if err = a.verifySecretReferenceCanBeRevoked(workspace, serviceID, reference); err != nil {
		return err
	}
	payload, err := a.runCLIJSONInWorkspaceWithTimeout(workspace, models.CLIIntent{Command: "service.secret.revoke", Target: "local", ServiceID: serviceID, Reference: reference}, 30*time.Second)
	if err != nil {
		return err
	}
	var response serviceSecretRevokeResult
	if err := decodeBoundedJSON(payload, &response); err != nil || response.SchemaVersion != "service-secret-revoke-result/v1" || response.Target != "local" || response.ServiceID != serviceID || response.Reference != reference || response.State != "revoked" {
		return errors.New("local secret revoke returned an invalid response")
	}
	return nil
}

func (a *App) verifySecretReferenceCanBeRevoked(workspace models.Workspace, serviceID, reference string) error {
	if a.files == nil || workspace.Project == nil {
		return errors.New("cannot verify the current Project configuration")
	}
	var service *models.RuntimeService
	for index := range workspace.Graph.Services {
		if workspace.Graph.Services[index].ID == serviceID {
			service = &workspace.Graph.Services[index]
			break
		}
	}
	if service == nil || service.SettingsPath == "" {
		return errors.New("cannot locate the service configuration in this Project")
	}
	settingsJSON, err := a.files.ReadFile(a.context(), workspace.Project.RootPath, service.SettingsPath)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return errors.New("cannot read the saved Project configuration")
	}
	if errors.Is(err, os.ErrNotExist) {
		settingsJSON = []byte(`{}`)
	}
	var document any
	if err = json.Unmarshal(settingsJSON, &document); err != nil || jsonContainsString(document, reference) {
		return errors.New("the saved Project configuration still uses this secret reference")
	}
	configurationJSON, err := json.Marshal(json.RawMessage(settingsJSON))
	if err != nil {
		return errors.New("cannot verify the saved Project configuration digest")
	}
	digest := sha256.Sum256(configurationJSON)
	status, err := a.runCLIJSONInWorkspaceWithTimeout(workspace, models.CLIIntent{Command: "service.status", Target: "local", ServiceID: serviceID}, 20*time.Second)
	if err != nil || !serviceStatusAcknowledgesDigest(status, serviceID, hex.EncodeToString(digest[:])) {
		return errors.New("all service replicas must acknowledge the saved Project configuration and be ready before revoking this secret")
	}
	return nil
}

func jsonContainsString(value any, target string) bool {
	switch typed := value.(type) {
	case string:
		return typed == target
	case []any:
		for _, child := range typed {
			if jsonContainsString(child, target) {
				return true
			}
		}
	case map[string]any:
		for _, child := range typed {
			if jsonContainsString(child, target) {
				return true
			}
		}
	}
	return false
}

func serviceStatusAcknowledgesDigest(payload []byte, serviceID, expectedDigest string) bool {
	if serviceID == "" || len(payload) == 0 || len(payload) > 1<<20 || len(expectedDigest) != 64 {
		return false
	}
	var status serviceSecretRuntimeStatus
	if err := json.Unmarshal(payload, &status); err != nil || status.InstanceID != serviceID || len(status.Replicas) == 0 || len(status.Replicas) > 4096 {
		return false
	}
	seen := make(map[string]struct{}, len(status.Replicas))
	for _, encoded := range status.Replicas {
		var replica serviceSecretRuntimeReplicaEnvelope
		if err := json.Unmarshal(encoded, &replica); err != nil {
			return false
		}
		var replicaID, artifactVersion, artifactDigest string
		var ready bool
		var identity serviceSecretRuntimeIdentity
		var readiness serviceSecretRuntimeReadiness
		var configuration serviceSecretRuntimeConfiguration
		if json.Unmarshal(replica.ReplicaID, &replicaID) != nil || json.Unmarshal(replica.ArtifactVersion, &artifactVersion) != nil ||
			json.Unmarshal(replica.ArtifactDigest, &artifactDigest) != nil || json.Unmarshal(replica.Ready, &ready) != nil ||
			json.Unmarshal(replica.Identity, &identity) != nil || json.Unmarshal(replica.Readiness, &readiness) != nil ||
			json.Unmarshal(replica.Configuration, &configuration) != nil {
			return false
		}
		if replicaID == "" || artifactVersion == "" || !validSettingsDigest(artifactDigest) ||
			identity.InstanceID != serviceID || identity.ReplicaID != replicaID ||
			readiness.InstanceID != serviceID || readiness.ReplicaID != replicaID ||
			!ready || !readiness.Ready || readiness.Generation == "" || readiness.PendingGeneration != "" ||
			readiness.SchemaVersion == "" || normalizeSecretDigest(readiness.SHA256) != expectedDigest ||
			configuration.State != "acknowledged" || configuration.DesiredGeneration == nil || configuration.AppliedGeneration == nil ||
			*configuration.DesiredGeneration <= 0 || *configuration.DesiredGeneration != *configuration.AppliedGeneration || configuration.LastFailureCode != "" {
			return false
		}
		if _, exists := seen[replicaID]; exists {
			return false
		}
		seen[replicaID] = struct{}{}
	}
	return true
}

type serviceSecretRuntimeReplicaEnvelope struct {
	ReplicaID       json.RawMessage `json:"replicaId"`
	ArtifactVersion json.RawMessage `json:"artifactVersion"`
	ArtifactDigest  json.RawMessage `json:"artifactDigest"`
	Identity        json.RawMessage `json:"identity"`
	Readiness       json.RawMessage `json:"readiness"`
	Configuration   json.RawMessage `json:"configuration"`
	Ready           json.RawMessage `json:"ready"`
}

type serviceSecretRuntimeIdentity struct {
	InstanceID string `json:"instanceId"`
	ReplicaID  string `json:"replicaId"`
}

type serviceSecretRuntimeReadiness struct {
	InstanceID        string `json:"instanceId"`
	ReplicaID         string `json:"replicaId"`
	Generation        string `json:"generation"`
	PendingGeneration string `json:"pendingGeneration"`
	SchemaVersion     string `json:"schemaVersion"`
	SHA256            string `json:"sha256"`
	Ready             bool   `json:"ready"`
}

type serviceSecretRuntimeConfiguration struct {
	DesiredGeneration *int64 `json:"desiredGeneration"`
	AppliedGeneration *int64 `json:"appliedGeneration"`
	State             string `json:"state"`
	LastFailureCode   string `json:"lastFailureCode"`
}

func validSecretReference(value string) bool {
	const prefix = "ssr:v1:"
	if len(value) != len(prefix)+32 || !strings.HasPrefix(value, prefix) {
		return false
	}
	_, err := hex.DecodeString(value[len(prefix):])
	return err == nil
}

func normalizeSecretDigest(value string) string {
	value = strings.TrimPrefix(value, "sha256:")
	if len(value) != 64 {
		return ""
	}
	if _, err := hex.DecodeString(value); err != nil {
		return ""
	}
	return value
}

func (a *App) currentSecretService(serviceID string) (models.Workspace, error) {
	if a.workspace == nil || a.cli == nil || !validSecretServiceID(serviceID) {
		return models.Workspace{}, models.ErrInvalidProject
	}
	workspace, err := a.workspace.Current(a.context())
	if err != nil || workspace.Project == nil {
		return models.Workspace{}, models.ErrInvalidProject
	}
	for _, service := range workspace.Graph.Services {
		if service.ID == serviceID {
			return workspace, nil
		}
	}
	return models.Workspace{}, models.ErrInvalidProject
}

func (a *App) declaredSecretPurpose(workspace models.Workspace, serviceID, purpose string) (bool, error) {
	if !validSecretPurpose(purpose) {
		return false, errors.New("secret purpose is invalid")
	}
	payload, err := a.runCLIJSONInWorkspaceWithTimeout(workspace, models.CLIIntent{Command: "service.manifest", Target: "local", ServiceID: serviceID}, 20*time.Second)
	if err != nil {
		return false, err
	}
	var manifest serviceSecretPurposeManifest
	if len(payload) == 0 || len(payload) > 1<<20 {
		return false, errors.New("service manifest returned an invalid secret purpose catalog")
	}
	if err := json.Unmarshal(payload, &manifest); err != nil {
		return false, fmt.Errorf("service manifest returned an invalid secret purpose catalog: %w", err)
	}
	if manifest.ID != serviceID || len(manifest.SecretPurposes) > 128 {
		return false, errors.New("service manifest returned an invalid secret purpose catalog")
	}
	for _, declared := range manifest.SecretPurposes {
		if !validSecretPurpose(declared) {
			return false, errors.New("service manifest returned an invalid secret purpose")
		}
		if declared == purpose {
			return true, nil
		}
	}
	return false, nil
}

func (a *App) runCLIRequestJSONWithTimeout(workspace models.Workspace, request models.CLIRequest, timeout time.Duration) (json.RawMessage, error) {
	defer clear(request.SecretInput)
	if workspace.Project == nil || a.cli == nil || request.ProjectRoot != workspace.Project.RootPath {
		return nil, models.ErrInvalidProject
	}
	if err := request.Validate(); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(a.context(), timeout)
	defer cancel()
	events, err := a.cli.Run(ctx, request)
	if err != nil {
		return nil, err
	}
	return structuredCLIResult(events)
}

func decodeBoundedJSON(payload []byte, destination any) error {
	if len(payload) == 0 || len(payload) > 1<<20 {
		return errors.New("invalid response size")
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return errors.New("trailing JSON data")
	}
	return nil
}

func validSecretServiceID(value string) bool {
	if strings.TrimSpace(value) != value || value == "" || len(value) > 128 {
		return false
	}
	for _, character := range value {
		if !strings.ContainsRune("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.", character) {
			return false
		}
	}
	return true
}

func validSecretPurpose(value string) bool {
	if strings.TrimSpace(value) != value || value == "" || len(value) > 192 {
		return false
	}
	for _, segment := range strings.Split(value, ".") {
		if segment == "" || segment[0] < 'a' || segment[0] > 'z' {
			return false
		}
		for _, character := range segment {
			if !strings.ContainsRune("abcdefghijklmnopqrstuvwxyz0123456789-", character) {
				return false
			}
		}
	}
	return true
}

func planCLIIntent(intent models.CLIIntent, root string) ([]string, error) {
	args, err := cliplan.Plan(intent, root)
	if err != nil {
		return nil, fmt.Errorf("plan service secret command: %w", err)
	}
	return args, nil
}
