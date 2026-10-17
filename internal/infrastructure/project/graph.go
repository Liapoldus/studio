package project

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/Liapoldus/studio/internal/domain/models"
	"gopkg.in/yaml.v3"
)

func graph(root string) (models.ServiceGraph, error) {
	if err := rejectLegacyRuntimeRoot(root); err != nil {
		return models.ServiceGraph{}, err
	}
	servicesRoot := filepath.Join(root, "services")
	entries, err := os.ReadDir(servicesRoot)
	if errors.Is(err, os.ErrNotExist) {
		return models.ServiceGraph{Services: []models.RuntimeService{}, Links: []models.ServiceLink{}}, nil
	}
	if err != nil {
		return models.ServiceGraph{}, err
	}
	services := make([]models.RuntimeService, 0, len(entries))
	links := make([]models.ServiceLink, 0)
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		serviceID := entry.Name()
		servicePath := filepath.Join("services", serviceID, "service.yaml")
		serviceBytes, readErr := fs.ReadFile(os.DirFS(root), filepath.ToSlash(servicePath))
		service := models.RuntimeService{
			ID:                 serviceID,
			Name:               manifestValueFromBytes(serviceBytes, "name"),
			Version:            manifestValueFromBytes(serviceBytes, "version"),
			ManifestVersion:    manifestValueFromBytes(serviceBytes, "manifestVersion"),
			ServicePath:        filepath.ToSlash(servicePath),
			SettingsPath:       filepath.ToSlash(filepath.Join("services", serviceID, "settings.json")),
			SettingsSchemaPath: filepath.ToSlash(manifestValueFromBytes(serviceBytes, "settingsSchema")),
			Configured:         fileExists(filepath.Join(root, "services", serviceID, "settings.json")),
			LinkPaths:          []string{},
		}
		if artifact, present, artifactErr := serviceArtifactFromBytes(serviceBytes); artifactErr != nil {
			service.ProblemCount++
		} else if present {
			service.Artifact = artifact
		}
		if service.Name == "" {
			service.Name = serviceID
		}
		if readErr != nil {
			service.ProblemCount++
		}
		if service.Version == "" {
			service.Version = "unknown"
		}
		if service.ManifestVersion == "" {
			service.ManifestVersion = "unknown"
		}
		if service.SettingsSchemaPath == "" {
			service.SettingsSchemaPath = filepath.ToSlash(filepath.Join("schemas", serviceID, "settings.json"))
		}
		if legacyRuntimePath(service.SettingsSchemaPath) {
			return models.ServiceGraph{}, ErrLegacyRuntimeProject
		}
		linkRoot := filepath.Join(root, "services", serviceID, "links")
		linkEntries, linkErr := os.ReadDir(linkRoot)
		if linkErr == nil {
			for _, linkEntry := range linkEntries {
				if linkEntry.IsDir() || !strings.HasSuffix(linkEntry.Name(), ".json") {
					continue
				}
				relative := filepath.ToSlash(filepath.Join("services", serviceID, "links", linkEntry.Name()))
				service.LinkPaths = append(service.LinkPaths, relative)
				link, parseErr := readLink(os.DirFS(root), relative, serviceID)
				if errors.Is(parseErr, ErrLegacyRuntimeProject) {
					return models.ServiceGraph{}, parseErr
				}
				if parseErr != nil {
					service.ProblemCount++
					link.Valid = false
				}
				links = append(links, link)
			}
		} else if !errors.Is(linkErr, os.ErrNotExist) {
			service.ProblemCount++
		}
		sort.Strings(service.LinkPaths)
		services = append(services, service)
	}
	sort.Slice(services, func(i, j int) bool { return services[i].ID < services[j].ID })
	sort.Slice(links, func(i, j int) bool { return links[i].SourcePath < links[j].SourcePath })
	return models.ServiceGraph{Services: services, Links: links}, nil
}

func serviceArtifactFromBytes(data []byte) (*models.ServiceArtifactReference, bool, error) {
	if len(data) == 0 {
		return nil, false, nil
	}
	var document yaml.Node
	if err := yaml.Unmarshal(data, &document); err != nil {
		return nil, false, err
	}
	root := mappingValue(&document, "artifact")
	if root == nil || root.Tag == "!!null" {
		return nil, false, nil
	}
	if root.Kind != yaml.MappingNode {
		return nil, true, models.ErrInvalidProject
	}
	read := func(key string) string {
		node := mappingValue(root, key)
		if node == nil || node.Kind != yaml.ScalarNode || node.Tag != "!!str" {
			return ""
		}
		return strings.TrimSpace(node.Value)
	}
	artifact := &models.ServiceArtifactReference{
		ID: read("id"), Version: read("version"), Platform: read("platform"), Digest: read("digest"),
	}
	if artifact.ID == "" && artifact.Version == "" && artifact.Platform == "" && artifact.Digest == "" {
		return nil, true, models.ErrInvalidProject
	}
	if !validArtifactReference(models.ServiceArtifactInput(*artifact)) {
		return nil, true, models.ErrInvalidProject
	}
	return artifact, true, nil
}

func mappingValue(document *yaml.Node, key string) *yaml.Node {
	if document == nil {
		return nil
	}
	if document.Kind == yaml.DocumentNode && len(document.Content) == 1 {
		document = document.Content[0]
	}
	if document.Kind != yaml.MappingNode {
		return nil
	}
	for index := 0; index+1 < len(document.Content); index += 2 {
		if document.Content[index].Value == key {
			return document.Content[index+1]
		}
	}
	return nil
}

func manifestValueFromBytes(data []byte, key string) string {
	for _, line := range strings.Split(string(data), "\n") {
		value, ok := manifestValue(strings.TrimSpace(line), key)
		if ok {
			return value
		}
	}
	return ""
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func readLink(source fs.FS, relative, fallbackCaller string) (models.ServiceLink, error) {
	link := models.ServiceLink{
		ID:         strings.TrimSuffix(filepath.Base(relative), filepath.Ext(relative)),
		Caller:     fallbackCaller,
		SourcePath: relative,
		Methods:    []string{},
	}
	data, err := fs.ReadFile(source, relative)
	if err != nil {
		return link, err
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(data, &object); err != nil {
		return link, err
	}
	link.Valid = true
	link.ID = stringValue(object["id"], link.ID)
	link.Caller = stringValue(object["caller"], link.Caller)
	link.Target = stringValue(object["target"], "")
	link.ContractVersion = stringValue(object["contractVersion"], stringValue(object["version"], ""))
	link.Transport = stringValue(object["transport"], "")
	link.RequestSchemaPath = stringValue(object["requestSchemaPath"], stringValue(object["requestSchema"], ""))
	link.ContractSchemaPath = stringValue(object["contractSchemaPath"], stringValue(object["schemaPath"], ""))
	link.ResponseSchemaPath = stringValue(object["responseSchemaPath"], stringValue(object["responseSchema"], ""))
	for _, path := range []string{link.RequestSchemaPath, link.ResponseSchemaPath, link.ContractSchemaPath} {
		if legacyRuntimePath(path) {
			return link, ErrLegacyRuntimeProject
		}
	}
	link.SecurityProfile = stringValue(object["securityProfile"], "")
	link.Compatibility = stringValue(object["compatibility"], "")
	link.RedactionPolicy = stringValue(object["redactionPolicy"], "")
	link.TimeoutMillis = int64Value(object["timeoutMillis"])
	link.RetryLimit = intValue(object["retryLimit"])
	if limits, ok := object["limits"]; ok {
		var values map[string]json.RawMessage
		if json.Unmarshal(limits, &values) == nil {
			link.RequestLimitBytes = int64Value(values["requestBytes"])
			link.ResponseLimitBytes = int64Value(values["responseBytes"])
		}
	}
	if raw, ok := object["methods"]; ok {
		if err := json.Unmarshal(raw, &link.Methods); err != nil {
			return link, err
		}
	}
	if raw, ok := object["disabledMethods"]; ok {
		if err := json.Unmarshal(raw, &link.DisabledMethods); err != nil {
			return link, err
		}
	}
	if link.Target == "" {
		return link, errors.New("link target is required")
	}
	return link, nil
}

func stringValue(raw json.RawMessage, fallback string) string {
	var value string
	if len(raw) > 0 && json.Unmarshal(raw, &value) == nil && strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	return fallback
}

func int64Value(raw json.RawMessage) int64 {
	var value int64
	if len(raw) > 0 && json.Unmarshal(raw, &value) == nil {
		return value
	}
	return 0
}

func intValue(raw json.RawMessage) int {
	var value int
	if len(raw) > 0 && json.Unmarshal(raw, &value) == nil {
		return value
	}
	return 0
}
