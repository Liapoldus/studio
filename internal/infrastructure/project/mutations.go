package project

import (
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
)

var (
	ErrGraphConfirmation  = errors.New("explicit graph confirmation is required")
	ErrGraphEntityExists  = errors.New("graph entity already exists")
	ErrGraphEntityMissing = errors.New("graph entity does not exist")
)

var _ interfaces.GraphRepository = Mutations{}

type Mutations struct{}

func (Mutations) CreateRuntimePlugin(ctx context.Context, root string, input models.RuntimePluginInput) error {
	if err := validateProjectRoot(root); err != nil {
		return err
	}
	if !validGraphToken(input.ID) || strings.TrimSpace(input.Name) == "" || strings.TrimSpace(input.Version) == "" || strings.TrimSpace(input.ManifestVersion) == "" {
		return models.ErrInvalidProject
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

func (Mutations) DeleteRuntimePlugin(ctx context.Context, root, id string, confirmed bool) error {
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

func (Mutations) CreatePluginLink(ctx context.Context, root string, input models.PluginLinkInput) error {
	if err := validateProjectRoot(root); err != nil {
		return err
	}
	if !validGraphToken(input.ID) || !validGraphToken(input.Caller) || !validGraphToken(input.Target) || len(input.Methods) == 0 {
		return models.ErrInvalidProject
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
	body, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return atomicWrite(path, append(body, '\n'))
}

func (Mutations) DeletePluginLink(ctx context.Context, root, caller, id string, confirmed bool) error {
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
