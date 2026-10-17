package project

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/Liapoldus/studio/internal/domain/interfaces"
	"github.com/Liapoldus/studio/internal/domain/models"
	"gopkg.in/yaml.v3"
)

var (
	ErrGraphConfirmation  = errors.New("explicit graph confirmation is required")
	ErrGraphEntityExists  = errors.New("graph entity already exists")
	ErrGraphEntityMissing = errors.New("graph entity does not exist")
)

var _ interfaces.GraphRepository = Mutations{}

type Mutations struct{}

func (Mutations) CreateRuntimeService(ctx context.Context, root string, input models.RuntimeServiceInput) error {
	if err := validateProjectRoot(root); err != nil {
		return err
	}
	if !validGraphToken(input.ID) || strings.TrimSpace(input.Name) == "" || strings.TrimSpace(input.Version) == "" || strings.TrimSpace(input.ManifestVersion) == "" {
		return models.ErrInvalidProject
	}
	if legacyRuntimePath(input.SettingsSchemaPath) {
		return ErrLegacyRuntimeProject
	}
	serviceRoot := filepath.Join(root, "services", input.ID)
	if _, err := os.Stat(serviceRoot); err == nil {
		return ErrGraphEntityExists
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.MkdirAll(filepath.Join(serviceRoot, "links"), 0700); err != nil {
		return err
	}
	created := true
	defer func() {
		if created {
			bestEffortRemoveAll(serviceRoot)
		}
	}()
	manifest := "id: " + strconv.Quote(strings.TrimSpace(input.ID)) + "\n" +
		"name: " + strconv.Quote(strings.TrimSpace(input.Name)) + "\n" +
		"version: " + strconv.Quote(strings.TrimSpace(input.Version)) + "\n" +
		"manifestVersion: " + strconv.Quote(strings.TrimSpace(input.ManifestVersion)) + "\n" +
		"settingsSchema: " + strconv.Quote(strings.TrimSpace(input.SettingsSchemaPath)) + "\n"
	if err := atomicWrite(filepath.Join(serviceRoot, "service.yaml"), []byte(manifest)); err != nil {
		return err
	}
	if err := atomicWrite(filepath.Join(serviceRoot, "settings.json"), []byte("{}\n")); err != nil {
		return err
	}
	created = false
	return nil
}

func (Mutations) SetRuntimeServiceArtifact(ctx context.Context, root, serviceID string, input models.ServiceArtifactInput) error {
	if err := validateProjectRoot(root); err != nil {
		return err
	}
	if !validGraphToken(serviceID) || input.ID != serviceID || !validArtifactReference(input) {
		return models.ErrInvalidProject
	}
	servicesRoot := filepath.Join(root, "services")
	serviceRoot := filepath.Join(servicesRoot, serviceID)
	manifestPath := filepath.Join(serviceRoot, "service.yaml")
	for _, directory := range []string{servicesRoot, serviceRoot} {
		info, err := os.Lstat(directory)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return ErrGraphEntityMissing
		}
	}
	info, err := os.Lstat(manifestPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return ErrGraphEntityMissing
		}
		return err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return models.ErrInvalidProject
	}
	if contextErr := ctx.Err(); contextErr != nil {
		return contextErr
	}
	data, err := os.ReadFile(manifestPath) //nolint:gosec // path is project-rooted and checked against symlinks above.
	if err != nil {
		return err
	}
	var document yaml.Node
	if err := yaml.Unmarshal(data, &document); err != nil {
		return err
	}
	rootNode := document.Content
	if len(rootNode) != 1 || rootNode[0].Kind != yaml.MappingNode {
		return models.ErrInvalidProject
	}
	manifest := rootNode[0]
	serviceIDNode := mappingValue(manifest, "id")
	serviceVersionNode := mappingValue(manifest, "version")
	if serviceIDNode == nil || serviceIDNode.Kind != yaml.ScalarNode || serviceIDNode.Value != serviceID || serviceVersionNode == nil || serviceVersionNode.Kind != yaml.ScalarNode {
		return models.ErrInvalidProject
	}
	serviceVersionNode.Tag = "!!str"
	serviceVersionNode.Value = input.Version
	serviceVersionNode.Style = yaml.DoubleQuotedStyle
	artifact := mappingValue(manifest, "artifact")
	if artifact == nil {
		artifact = &yaml.Node{Kind: yaml.MappingNode, Tag: "!!map"}
		manifest.Content = append(manifest.Content,
			&yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: "artifact"}, artifact,
		)
	} else if artifact.Kind != yaml.MappingNode {
		return models.ErrInvalidProject
	}
	for _, field := range []struct{ key, value string }{
		{"id", input.ID}, {"version", input.Version}, {"platform", input.Platform}, {"digest", input.Digest},
	} {
		value := mappingValue(artifact, field.key)
		if value == nil {
			artifact.Content = append(artifact.Content,
				&yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: field.key},
				&yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: field.value},
			)
			continue
		}
		if value.Kind != yaml.ScalarNode {
			return models.ErrInvalidProject
		}
		value.Kind, value.Tag, value.Value, value.Style = yaml.ScalarNode, "!!str", field.value, yaml.DoubleQuotedStyle
	}
	var output bytes.Buffer
	encoder := yaml.NewEncoder(&output)
	encoder.SetIndent(2)
	if err := encoder.Encode(&document); err != nil {
		return err
	}
	if err := encoder.Close(); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return atomicWrite(manifestPath, output.Bytes())
}

func validArtifactReference(input models.ServiceArtifactInput) bool {
	if !validGraphToken(input.ID) || !validGraphToken(input.Version) {
		return false
	}
	if !strings.Contains(input.Platform, "/") || strings.Count(input.Platform, "/") != 1 {
		return false
	}
	platform := strings.Split(input.Platform, "/")
	if !validGraphToken(platform[0]) || !validGraphToken(platform[1]) {
		return false
	}
	digest := strings.TrimPrefix(input.Digest, "sha256:")
	if len(digest) != 64 || input.Digest != "sha256:"+digest {
		return false
	}
	for _, char := range digest {
		if !strings.ContainsRune("0123456789abcdef", char) {
			return false
		}
	}
	return true
}

func (Mutations) DeleteRuntimeService(ctx context.Context, root, id string, confirmed bool) error {
	if err := validateProjectRoot(root); err != nil {
		return err
	}
	if !confirmed || !validGraphToken(id) {
		return ErrGraphConfirmation
	}
	serviceRoot := filepath.Join(root, "services", id)
	entries, err := os.ReadDir(serviceRoot)
	if errors.Is(err, os.ErrNotExist) {
		return ErrGraphEntityMissing
	}
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.Name() == "service.yaml" || entry.Name() == "settings.json" {
			continue
		}
		if entry.Name() != "links" || !entry.IsDir() {
			return fmt.Errorf("refusing to delete unknown service file %q", entry.Name())
		}
		links, readErr := os.ReadDir(filepath.Join(serviceRoot, "links"))
		if readErr != nil {
			return readErr
		}
		for _, link := range links {
			if link.IsDir() || !strings.HasSuffix(link.Name(), ".json") {
				return fmt.Errorf("refusing to delete unknown link file %q", link.Name())
			}
		}
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return os.RemoveAll(serviceRoot)
}

func (Mutations) CreateServiceLink(ctx context.Context, root string, input models.ServiceLinkInput) error {
	if err := validateProjectRoot(root); err != nil {
		return err
	}
	if !validGraphToken(input.ID) || !validGraphToken(input.Caller) || !validGraphToken(input.Target) || len(input.Methods) == 0 {
		return models.ErrInvalidProject
	}
	for _, reference := range []string{input.RequestSchemaPath, input.ResponseSchemaPath, input.ContractSchemaPath} {
		if legacyRuntimePath(reference) {
			return ErrLegacyRuntimeProject
		}
	}
	for _, method := range input.Methods {
		if !validGraphToken(method) {
			return models.ErrInvalidProject
		}
	}
	for _, id := range []string{input.Caller, input.Target} {
		info, err := os.Stat(filepath.Join(root, "services", id))
		if err != nil || !info.IsDir() {
			return ErrGraphEntityMissing
		}
	}
	path := filepath.Join(root, "services", input.Caller, "links", input.ID+".json")
	if _, err := os.Stat(path); err == nil {
		return ErrGraphEntityExists
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	body, err := marshalServiceLink(input)
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return atomicWrite(path, append(body, '\n'))
}

func (Mutations) UpdateServiceLink(ctx context.Context, root, caller, id string, input models.ServiceLinkInput) error {
	if err := validateProjectRoot(root); err != nil {
		return err
	}
	if !validGraphToken(caller) || !validGraphToken(id) || input.Caller != caller || input.ID != id || !validGraphToken(input.Target) || input.Target == caller || len(input.Methods) == 0 {
		return models.ErrInvalidProject
	}
	if strings.TrimSpace(input.ContractVersion) == "" || !validGraphToken(input.Transport) || !validGraphToken(input.SecurityProfile) || !validGraphToken(input.Compatibility) || !validGraphToken(input.RedactionPolicy) {
		return models.ErrInvalidProject
	}
	if input.TimeoutMillis <= 0 || input.TimeoutMillis > 604800000 || input.RetryLimit < 0 || input.RetryLimit > 100 || input.RequestLimitBytes <= 0 || input.ResponseLimitBytes <= 0 {
		return models.ErrInvalidProject
	}
	for _, method := range input.Methods {
		if !validGraphToken(method) {
			return models.ErrInvalidProject
		}
	}
	for _, method := range input.DisabledMethods {
		if !validGraphToken(method) {
			return models.ErrInvalidProject
		}
	}
	for _, reference := range []string{input.RequestSchemaPath, input.ResponseSchemaPath, input.ContractSchemaPath} {
		if legacyRuntimePath(reference) {
			return ErrLegacyRuntimeProject
		}
		if reference != "" && !validProjectReference(reference) {
			return models.ErrInvalidProject
		}
	}
	for _, serviceID := range []string{caller, input.Target} {
		info, err := os.Stat(filepath.Join(root, "services", serviceID))
		if err != nil || !info.IsDir() {
			return ErrGraphEntityMissing
		}
	}
	directory := filepath.Join(root, "services", caller, "links")
	for _, path := range []string{filepath.Join(root, "services"), filepath.Join(root, "services", caller), directory} {
		info, err := os.Lstat(path)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return ErrGraphEntityMissing
		}
	}
	path := filepath.Join(directory, id+".json")
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return ErrGraphEntityMissing
	}
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return models.ErrInvalidProject
	}
	body, err := marshalServiceLink(input)
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return atomicWrite(path, append(body, '\n'))
}

func marshalServiceLink(input models.ServiceLinkInput) ([]byte, error) {
	value := map[string]any{
		"id": input.ID, "caller": input.Caller, "target": input.Target,
		"contractVersion": input.ContractVersion, "methods": input.Methods,
		"transport": input.Transport, "requestSchemaPath": input.RequestSchemaPath,
		"responseSchemaPath": input.ResponseSchemaPath, "contractSchemaPath": input.ContractSchemaPath,
		"securityProfile": input.SecurityProfile, "timeoutMillis": input.TimeoutMillis,
		"retryLimit": input.RetryLimit, "limits": map[string]int64{"requestBytes": input.RequestLimitBytes, "responseBytes": input.ResponseLimitBytes},
		"disabledMethods": input.DisabledMethods, "compatibility": input.Compatibility,
		"redactionPolicy": input.RedactionPolicy,
	}
	return json.MarshalIndent(value, "", "  ")
}

func validProjectReference(value string) bool {
	if filepath.IsAbs(value) || strings.ContainsAny(value, "\\\x00\r\n") {
		return false
	}
	clean := filepath.ToSlash(filepath.Clean(filepath.FromSlash(value)))
	return clean != "." && clean != ".." && !strings.HasPrefix(clean, "../") && clean == value
}

func (Mutations) DeleteServiceLink(ctx context.Context, root, caller, id string, confirmed bool) error {
	if err := validateProjectRoot(root); err != nil {
		return err
	}
	if !confirmed || !validGraphToken(caller) || !validGraphToken(id) {
		return ErrGraphConfirmation
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	path := filepath.Join(root, "services", caller, "links", id+".json")
	if err := os.Remove(path); errors.Is(err, os.ErrNotExist) {
		return ErrGraphEntityMissing
	} else {
		return err
	}
}

func validateProjectRoot(root string) error {
	root = filepath.Clean(strings.TrimSpace(root))
	if !filepath.IsAbs(root) || strings.ContainsRune(root, '\x00') {
		return models.ErrInvalidProject
	}
	if err := rejectLegacyRuntimeRoot(root); err != nil {
		return err
	}
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		return models.ErrInvalidProject
	}
	return nil
}

func validGraphToken(value string) bool {
	value = strings.TrimSpace(value)
	return value != "" && value != "." && value != ".." && !strings.ContainsAny(value, "/\\\x00\r\n:")
}

func atomicWrite(path string, data []byte) error {
	file, err := os.CreateTemp(filepath.Dir(path), ".studio-graph-*")
	if err != nil {
		return err
	}
	temporary := file.Name()
	defer bestEffortRemove(temporary)
	if err := file.Chmod(0600); err != nil {
		return errors.Join(err, file.Close())
	}
	if _, err := file.Write(data); err != nil {
		return errors.Join(err, file.Close())
	}
	if err := file.Sync(); err != nil {
		return errors.Join(err, file.Close())
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(temporary, path)
}

func bestEffortRemoveAll(path string) {
	if err := os.RemoveAll(path); err != nil {
		return
	}
}

func bestEffortRemove(path string) {
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return
	}
}
