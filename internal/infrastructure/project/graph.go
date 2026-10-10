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
)

func graph(root string) (models.PluginGraph, error) {
	servicesRoot := filepath.Join(root, "services")
	entries, err := os.ReadDir(servicesRoot)
	if errors.Is(err, os.ErrNotExist) {
		return models.PluginGraph{Plugins: []models.RuntimePlugin{}, Links: []models.PluginLink{}}, nil
	}
	if err != nil {
		return models.PluginGraph{}, err
	}
	plugins := make([]models.RuntimePlugin, 0, len(entries))
	links := make([]models.PluginLink, 0)
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		serviceID := entry.Name()
		servicePath := filepath.Join("services", serviceID, "service.yaml")
		serviceBytes, readErr := fs.ReadFile(os.DirFS(root), filepath.ToSlash(servicePath))
		plugin := models.RuntimePlugin{
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
		if plugin.Name == "" {
			plugin.Name = serviceID
		}
		if readErr != nil {
			plugin.ProblemCount++
		}
		if plugin.Version == "" {
			plugin.Version = "unknown"
		}
		if plugin.ManifestVersion == "" {
			plugin.ManifestVersion = "unknown"
		}
		if plugin.SettingsSchemaPath == "" {
			plugin.SettingsSchemaPath = filepath.ToSlash(filepath.Join("schemas", serviceID, "settings.json"))
		}
		linkRoot := filepath.Join(root, "services", serviceID, "links")
		linkEntries, linkErr := os.ReadDir(linkRoot)
		if linkErr == nil {
			for _, linkEntry := range linkEntries {
				if linkEntry.IsDir() || !strings.HasSuffix(linkEntry.Name(), ".json") {
					continue
				}
				relative := filepath.ToSlash(filepath.Join("services", serviceID, "links", linkEntry.Name()))
				plugin.LinkPaths = append(plugin.LinkPaths, relative)
				link, parseErr := readLink(os.DirFS(root), relative, serviceID)
				if parseErr != nil {
					plugin.ProblemCount++
					link.Valid = false
				}
				links = append(links, link)
			}
		} else if !errors.Is(linkErr, os.ErrNotExist) {
			plugin.ProblemCount++
		}
		sort.Strings(plugin.LinkPaths)
		plugins = append(plugins, plugin)
	}
	sort.Slice(plugins, func(i, j int) bool { return plugins[i].ID < plugins[j].ID })
	sort.Slice(links, func(i, j int) bool { return links[i].SourcePath < links[j].SourcePath })
	return models.PluginGraph{Plugins: plugins, Links: links}, nil
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

func readLink(source fs.FS, relative, fallbackCaller string) (models.PluginLink, error) {
	link := models.PluginLink{
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
