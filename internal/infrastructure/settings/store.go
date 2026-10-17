// Package settings implements the schema-aware project settings boundary.
package settings

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/Liapoldus/studio/internal/domain/interfaces"
	"github.com/Liapoldus/studio/internal/domain/models"
)

var (
	ErrInvalidSchema    = errors.New("invalid settings schema")
	ErrSensitiveField   = errors.New("sensitive settings fields are managed outside Studio")
	ErrUnsupportedPatch = errors.New("settings patch is not allowed by schema")
	ErrSettingsConflict = errors.New("project settings changed since this draft was loaded")
)

const protectedArrayOperationsKey = "$studioArrayOps/v1"
const configurationMapOperationsKey = "$studioMapOps/v1"
const configurationJSONDocumentKey = "$studioJSONDocument/v1"

type configurationMapOperation struct {
	operation string
	key       string
}

type protectedArrayOperationKind uint8

const (
	protectedArraySet protectedArrayOperationKind = iota + 1
	protectedArrayInsert
	protectedArrayRemove
	protectedArrayMove
	protectedArrayDuplicate
)

type protectedArrayOperation struct {
	patch  map[string]any
	value  any
	first  int
	second int
	kind   protectedArrayOperationKind
}

type Store struct {
	Files interfaces.FileSystem
}

var _ interfaces.SettingsStore = Store{}

func (s Store) ReadSchema(ctx context.Context, root, schemaPath string) ([]byte, error) {
	if s.Files == nil {
		return nil, ErrInvalidSchema
	}
	schema, err := s.readSchema(ctx, root, schemaPath)
	if err != nil {
		return nil, err
	}
	safe := redactSchema(schema, "")
	return json.MarshalIndent(safe, "", "  ")
}

// ValidateSchemaDocument validates an SDK-provided schema against the same
// project-confined reference rules used when reading a canonical schema file.
// It does not write or persist the document.
func (s Store) ValidateSchemaDocument(ctx context.Context, root, schemaPath string, data []byte) error {
	_, err := s.resolveSchemaDocument(ctx, root, schemaPath, data)
	return err
}

// RedactSchemaDocument returns a renderer-safe, validated schema projection.
// Sensitive defaults/enums/examples are removed using the same policy as the
// canonical Project schema reader.
func (s Store) RedactSchemaDocument(ctx context.Context, root, schemaPath string, data []byte) ([]byte, error) {
	schema, err := s.resolveSchemaDocument(ctx, root, schemaPath, data)
	if err != nil {
		return nil, err
	}
	redacted, err := json.MarshalIndent(redactSchema(schema, ""), "", "  ")
	if err != nil {
		return nil, ErrInvalidSchema
	}
	return redacted, nil
}

// ValidateValuesAgainstSchemaDocument checks the Project's stored settings plus
// a host-validated safe draft overlay against a candidate SDK schema. It never
// returns settings values and never writes Project files.
func (s Store) ValidateValuesAgainstSchemaDocument(ctx context.Context, root, settingsPath, schemaPath string, candidateSchema, patch []byte) (bool, error) {
	if s.Files == nil {
		return false, ErrInvalidSchema
	}
	currentSchema, err := s.readSchema(ctx, root, schemaPath)
	if err != nil {
		return false, err
	}
	resolvedCandidate, err := s.resolveSchemaDocument(ctx, root, schemaPath, candidateSchema)
	if err != nil {
		return false, err
	}
	current, err := s.readJSON(ctx, root, settingsPath, false)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return false, err
	}
	if current == nil {
		current = map[string]any{}
	}
	draft, err := decodePatch(patch)
	if err != nil {
		return false, err
	}
	if err = validatePatchSafety(draft, currentSchema, ""); err != nil {
		return false, err
	}
	values, err := mergeSafe(current, draft, currentSchema)
	if err != nil {
		return false, err
	}
	if err = validateValue(values, resolvedCandidate, "$"); err == nil {
		return true, nil
	} else if errors.Is(err, ErrUnsupportedPatch) {
		return false, nil
	} else {
		return false, err
	}
}

func (s Store) Read(ctx context.Context, root, settingsPath, schemaPath string) ([]byte, error) {
	snapshot, err := s.Snapshot(ctx, root, settingsPath, schemaPath)
	if err != nil {
		return nil, err
	}
	return []byte(snapshot.ValuesJSON), nil
}

func (s Store) Snapshot(ctx context.Context, root, settingsPath, schemaPath string) (models.ProjectSettingsSnapshot, error) {
	if s.Files == nil {
		return models.ProjectSettingsSnapshot{}, ErrInvalidSchema
	}
	schema, err := s.readSchema(ctx, root, schemaPath)
	if err != nil {
		return models.ProjectSettingsSnapshot{}, err
	}
	raw, err := s.Files.ReadFile(ctx, root, settingsPath)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return models.ProjectSettingsSnapshot{}, err
	}
	settings := any(map[string]any{})
	if err == nil {
		if decodeErr := json.Unmarshal(raw, &settings); decodeErr != nil {
			return models.ProjectSettingsSnapshot{}, decodeErr
		}
		if _, ok := settings.(map[string]any); !ok {
			return models.ProjectSettingsSnapshot{}, ErrInvalidSchema
		}
	}
	if settings == nil {
		settings = map[string]any{}
	}
	safe := redactValue(settings, schema)
	values, err := json.MarshalIndent(safe, "", "  ")
	if err != nil {
		return models.ProjectSettingsSnapshot{}, err
	}
	digest := sha256.Sum256(raw)
	// CLI embeds settings as json.RawMessage: encoding/json compacts whitespace
	// and escapes HTML characters before Core hashes the candidate bytes.
	configurationJSON := raw
	if len(configurationJSON) == 0 {
		configurationJSON = []byte(`{}`)
	}
	encoded, err := json.Marshal(json.RawMessage(configurationJSON))
	if err != nil {
		return models.ProjectSettingsSnapshot{}, err
	}
	configurationDigest := sha256.Sum256(encoded)
	return models.ProjectSettingsSnapshot{ValuesJSON: string(values), Digest: fmt.Sprintf("sha256:%x", digest), ConfigurationDigest: fmt.Sprintf("sha256:%x", configurationDigest)}, nil
}

// ValidatePatch checks that a draft contains only schema-declared,
// non-sensitive writable values. It deliberately does not enforce cross-field
// constraints, so incomplete drafts can be safely persisted while editing.
func (s Store) ValidatePatch(ctx context.Context, root, settingsPath, schemaPath string, patch []byte) error {
	if s.Files == nil {
		return ErrInvalidSchema
	}
	schema, err := s.readSchema(ctx, root, schemaPath)
	if err != nil {
		return err
	}
	current, err := s.readJSON(ctx, root, settingsPath, false)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if current == nil {
		current = map[string]any{}
	}
	value, err := decodePatch(patch)
	if err != nil {
		return err
	}
	if err = validatePatchSafety(value, schema, ""); err != nil {
		return err
	}
	_, err = mergeSafe(current, value, schema)
	return err
}

func (s Store) Update(ctx context.Context, root, settingsPath, schemaPath string, patch []byte) error {
	return s.update(ctx, root, settingsPath, schemaPath, "", patch)
}

func (s Store) UpdateIfDigest(ctx context.Context, root, settingsPath, schemaPath, expectedDigest string, patch []byte) error {
	if expectedDigest == "" {
		return ErrSettingsConflict
	}
	return s.update(ctx, root, settingsPath, schemaPath, expectedDigest, patch)
}

func (s Store) update(ctx context.Context, root, settingsPath, schemaPath, expectedDigest string, patch []byte) error {
	if s.Files == nil {
		return ErrInvalidSchema
	}
	raw, readErr := s.Files.ReadFile(ctx, root, settingsPath)
	if readErr != nil && !errors.Is(readErr, os.ErrNotExist) {
		return readErr
	}
	actualDigest := sha256.Sum256(raw)
	if expectedDigest != "" && expectedDigest != fmt.Sprintf("sha256:%x", actualDigest) {
		return ErrSettingsConflict
	}
	schema, err := s.readSchema(ctx, root, schemaPath)
	if err != nil {
		return err
	}
	current, err := s.readJSON(ctx, root, settingsPath, false)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if current == nil {
		current = map[string]any{}
	}
	value, err := decodePatch(patch)
	if err != nil {
		return err
	}
	if err = validatePatchSafety(value, schema, ""); err != nil {
		return err
	}
	merged, err := mergeSafe(current, value, schema)
	if err != nil {
		return err
	}
	if validationErr := validateValue(merged, schema, "$"); validationErr != nil {
		return validationErr
	}
	data, err := json.MarshalIndent(merged, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	if expectedDigest == "" {
		return s.Files.WriteFile(ctx, root, settingsPath, data)
	}
	written, err := s.Files.WriteFileIfDigest(ctx, root, settingsPath, expectedDigest, data)
	if err != nil {
		return err
	}
	if !written {
		return ErrSettingsConflict
	}
	return nil
}

func decodePatch(patch []byte) (any, error) {
	if len(patch) == 0 || len(patch) > 1<<20 {
		return nil, ErrUnsupportedPatch
	}
	var value any
	if err := json.Unmarshal(patch, &value); err != nil {
		return nil, fmt.Errorf("decode settings patch: %w", err)
	}
	if _, ok := value.(map[string]any); !ok {
		return nil, ErrUnsupportedPatch
	}
	return value, nil
}

func validateJSONDocument(value any, depth int, nodes *int) error {
	(*nodes)++
	if depth > 64 || *nodes > 100_000 {
		return ErrUnsupportedPatch
	}
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			if key == "__proto__" || key == "prototype" || key == "constructor" || len(key) > 256 {
				return ErrUnsupportedPatch
			}
			if err := validateJSONDocument(child, depth+1, nodes); err != nil {
				return err
			}
		}
	case []any:
		for _, child := range typed {
			if err := validateJSONDocument(child, depth+1, nodes); err != nil {
				return err
			}
		}
	}
	return nil
}

func markedJSONValue(value any) (any, error) {
	patch, ok := value.(map[string]any)
	if !ok || len(patch) != 1 {
		return nil, ErrUnsupportedPatch
	}
	document, exists := patch[configurationJSONDocumentKey]
	if !exists {
		return nil, ErrUnsupportedPatch
	}
	if err := validateJSONDocument(document, 0, new(int)); err != nil {
		return nil, err
	}
	return document, nil
}

func validatePatchSafety(value, schema any, propertyName string) error {
	if isSensitive(schema, propertyName) {
		return ErrSensitiveField
	}
	schemaObject, schemaOK := schema.(map[string]any)
	if !schemaOK {
		return ErrInvalidSchema
	}
	if readOnly, exists := schemaObject["readOnly"].(bool); exists && readOnly {
		return ErrUnsupportedPatch
	}
	if schemaObject["x-studio-json-value"] == true {
		_, err := markedJSONValue(value)
		return err
	}
	if schemaObject["x-studio-json-document"] == true {
		patch, ok := value.(map[string]any)
		if !ok || len(patch) != 1 {
			return ErrUnsupportedPatch
		}
		document, exists := patch[configurationJSONDocumentKey]
		if !exists {
			return ErrUnsupportedPatch
		}
		if _, ok = document.(map[string]any); !ok {
			return ErrUnsupportedPatch
		}
		return validateJSONDocument(document, 0, new(int))
	}
	if schemaObject["x-studio-json-document"] == true {
		patch, ok := value.(map[string]any)
		if !ok || len(patch) != 1 {
			return ErrUnsupportedPatch
		}
		document, exists := patch[configurationJSONDocumentKey]
		if !exists {
			return ErrUnsupportedPatch
		}
		return validateJSONDocument(document, 0, new(int))
	}
	// Composition schemas can declare protected properties inside their
	// branches. Inspect every branch for safety even though the editor may be
	// working with an incomplete draft that does not yet satisfy that branch.
	// Secret/read-only annotations are policy, not branch-specific validation.
	for _, keyword := range []string{"allOf", "anyOf", "oneOf"} {
		branchesValue, exists := schemaObject[keyword]
		if !exists {
			continue
		}
		branches, err := schemaBranches(branchesValue)
		if err != nil {
			return err
		}
		if keyword != "allOf" {
			// A patch for a tagged union only needs to be writable under a
			// compatible branch. Requiring it to satisfy every oneOf/anyOf
			// branch rejects valid variants (for example a service route because
			// it is not also a reverse-proxy route). Sensitive annotations are
			// still a global policy: a secret/read-only field declared by any
			// branch remains forbidden even when another branch would accept it.
			var branchErr error
			matched := false
			for _, branch := range branches {
				branchErr = validatePatchSafety(value, branch, propertyName)
				if branchErr == nil {
					matched = true
					continue
				}
				if errors.Is(branchErr, ErrSensitiveField) {
					return branchErr
				}
			}
			if !matched {
				if branchErr != nil {
					return branchErr
				}
				return ErrUnsupportedPatch
			}
			continue
		}
		for _, branch := range branches {
			if err := validatePatchSafety(value, branch, propertyName); err != nil {
				return err
			}
		}
	}
	schemaType, schemaTypeOK := schemaObject["type"].(string)
	if schemaTypeOK && schemaType == "array" {
		itemSchema, exists := schemaObject["items"]
		if !exists {
			return ErrInvalidSchema
		}
		if sparsePatch, ok := value.(map[string]any); ok {
			if _, exists := sparsePatch[protectedArrayOperationsKey]; exists {
				_, err := decodeProtectedArrayOperations(sparsePatch, itemSchema)
				return err
			}
			for index, child := range sparsePatch {
				if _, err := parseArrayPatchIndex(index); err != nil {
					return err
				}
				if err := validatePatchSafety(child, itemSchema, ""); err != nil {
					return err
				}
			}
			return nil
		}
		if _, replacement := value.([]any); replacement && containsProtectedConfigurationField(itemSchema, "", 0) {
			return ErrSensitiveField
		}
	}
	switch patch := value.(type) {
	case map[string]any:
		if _, exists := patch[configurationMapOperationsKey]; exists {
			if _, err := decodeConfigurationMapOperations(patch, schemaObject); err != nil {
				return err
			}
		}
		for key, child := range patch {
			if key == configurationMapOperationsKey {
				continue
			}
			if key == "__proto__" || key == "prototype" || key == "constructor" {
				return fmt.Errorf("%w: forbidden property %s", ErrUnsupportedPatch, key)
			}
			childSchema := propertySchema(schemaObject, key)
			if isSensitive(childSchema, key) {
				return fmt.Errorf("%w: %s", ErrSensitiveField, key)
			}
			if childObject, ok := childSchema.(map[string]any); ok {
				if readOnly, exists := childObject["readOnly"].(bool); exists && readOnly {
					return fmt.Errorf("%w: %s is read-only", ErrUnsupportedPatch, key)
				}
			}
			if _, declared := schemaProperty(schemaObject, key); declared {
				if err := validatePatchSafety(child, childSchema, key); err != nil {
					return err
				}
				continue
			}
			additional, hasAdditional := schemaObject["additionalProperties"]
			if !hasAdditional || additional == false {
				continue // mergeSafe returns the canonical unsupported-property error.
			}
			if allowed, open := additional.(bool); open {
				if !allowed {
					continue // mergeSafe returns the canonical unsupported-property error.
				}
				switch child.(type) {
				case map[string]any, []any:
					return fmt.Errorf("%w: untyped structured value %s", ErrUnsupportedPatch, key)
				default:
					continue
				}
			}
			if err := validatePatchSafety(child, additional, key); err != nil {
				return err
			}
		}
	case []any:
		if itemSchema, exists := schemaObject["items"]; exists {
			if containsProtectedConfigurationField(itemSchema, "", 0) {
				return ErrSensitiveField
			}
			for _, child := range patch {
				if err := validatePatchSafety(child, itemSchema, propertyName); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

func schemaProperty(schema map[string]any, name string) (any, bool) {
	if properties, ok := schema["properties"].(map[string]any); ok {
		if child, exists := properties[name]; exists {
			return child, true
		}
	}
	return patternPropertySchema(schema, name)
}

func (s Store) readJSON(ctx context.Context, root, path string, required bool) (any, error) {
	data, err := s.Files.ReadFile(ctx, root, path)
	if err != nil {
		if !required && errors.Is(err, os.ErrNotExist) {
			return nil, err
		}
		return nil, err
	}
	var value any
	if err := json.Unmarshal(data, &value); err != nil {
		return nil, err
	}
	if _, ok := value.(map[string]any); !ok {
		return nil, ErrInvalidSchema
	}
	return value, nil
}

func (s Store) readSchema(ctx context.Context, root, schemaPath string) (any, error) {
	if s.Files == nil {
		return nil, ErrInvalidSchema
	}
	data, err := s.Files.ReadFile(ctx, root, schemaPath)
	if err != nil {
		return nil, err
	}
	return s.resolveSchemaDocument(ctx, root, schemaPath, data)
}

func (s Store) resolveSchemaDocument(ctx context.Context, root, schemaPath string, data []byte) (any, error) {
	if s.Files == nil || len(data) == 0 || len(data) > 1<<20 {
		return nil, ErrInvalidSchema
	}
	normalized, err := normalizeSchemaPath(schemaPath)
	if err != nil {
		return nil, err
	}
	var value any
	if err := json.Unmarshal(data, &value); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrInvalidSchema, err)
	}
	if _, ok := value.(map[string]any); !ok {
		return nil, ErrInvalidSchema
	}
	resolver := schemaResolver{
		readFile: func(path string) ([]byte, error) {
			return s.Files.ReadFile(ctx, root, path)
		},
		docs:  map[string]any{},
		ids:   map[string]string{},
		stack: map[string]bool{},
	}
	if err := resolver.register(normalized, value); err != nil {
		return nil, err
	}
	return resolver.resolve(value, normalized, value)
}

type schemaResolver struct {
	readFile func(string) ([]byte, error)
	docs     map[string]any
	ids      map[string]string
	stack    map[string]bool
}

func (resolver *schemaResolver) register(documentPath string, value any) error {
	resolver.docs[documentPath] = value
	object, ok := value.(map[string]any)
	if !ok {
		return fmt.Errorf("%w: schema document must be an object", ErrInvalidSchema)
	}
	id, ok := object["$id"].(string)
	if !ok || strings.TrimSpace(id) == "" {
		return nil
	}
	if strings.ContainsAny(id, "\r\n") {
		return fmt.Errorf("%w: schema $id contains control characters", ErrInvalidSchema)
	}
	if previous, exists := resolver.ids[id]; exists && previous != documentPath {
		return fmt.Errorf("%w: duplicate schema $id %s", ErrInvalidSchema, id)
	}
	resolver.ids[id] = documentPath
	return nil
}

func (resolver *schemaResolver) resolve(value any, documentPath string, documentRoot any) (any, error) {
	switch typed := value.(type) {
	case []any:
		result := make([]any, len(typed))
		for index, child := range typed {
			resolved, err := resolver.resolve(child, documentPath, documentRoot)
			if err != nil {
				return nil, err
			}
			result[index] = resolved
		}
		return result, nil
	case map[string]any:
		if ref, ok := typed["$ref"].(string); ok {
			target, targetPath, targetRoot, fragment, err := resolver.reference(ref, documentPath, documentRoot)
			if err != nil {
				return nil, err
			}
			key := targetPath + "#" + fragment
			if resolver.stack[key] {
				return nil, fmt.Errorf("%w: cyclic schema reference %s", ErrInvalidSchema, ref)
			}
			resolver.stack[key] = true
			resolvedTarget, resolveErr := resolver.resolve(target, targetPath, targetRoot)
			delete(resolver.stack, key)
			if resolveErr != nil {
				return nil, resolveErr
			}
			resolvedObject, ok := resolvedTarget.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("%w: $ref %s does not resolve to an object schema", ErrInvalidSchema, ref)
			}
			result := cloneObject(resolvedObject)
			keys := sortedSchemaKeys(typed)
			for _, key := range keys {
				if key == "$ref" {
					continue
				}
				child := typed[key]
				resolved, err := resolver.resolve(child, documentPath, documentRoot)
				if err != nil {
					return nil, err
				}
				result[key] = resolved
			}
			return result, nil
		}
		result := make(map[string]any, len(typed))
		for _, key := range sortedSchemaKeys(typed) {
			child := typed[key]
			resolved, err := resolver.resolve(child, documentPath, documentRoot)
			if err != nil {
				return nil, err
			}
			result[key] = resolved
		}
		return result, nil
	default:
		return value, nil
	}
}

func sortedSchemaKeys(value map[string]any) []string {
	keys := make([]string, 0, len(value))
	for key := range value {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func (resolver *schemaResolver) reference(ref, documentPath string, documentRoot any) (any, string, any, string, error) {
	parts := strings.SplitN(ref, "#", 2)
	pathPart := parts[0]
	fragment := ""
	if len(parts) == 2 {
		fragment = parts[1]
	}
	targetPath := documentPath
	targetRoot := documentRoot
	if pathPart != "" {
		if registeredPath, registered := resolver.ids[pathPart]; registered {
			targetPath = registeredPath
			targetRoot = resolver.docs[targetPath]
		} else {
			if filepath.IsAbs(pathPart) || strings.Contains(pathPart, "://") {
				return nil, "", nil, "", fmt.Errorf("%w: unregistered external schema reference %s", ErrInvalidSchema, ref)
			}
			resolvedPath, err := normalizeSchemaPath(filepath.Join(filepath.Dir(documentPath), pathPart))
			if err != nil {
				return nil, "", nil, "", fmt.Errorf("%w: schema reference %s", ErrInvalidSchema, ref)
			}
			targetPath = resolvedPath
			loaded, ok := resolver.docs[targetPath]
			if !ok {
				data, err := resolver.readFile(targetPath)
				if err != nil {
					return nil, "", nil, "", fmt.Errorf("resolve schema reference %s: %w", ref, err)
				}
				if err := json.Unmarshal(data, &loaded); err != nil {
					return nil, "", nil, "", fmt.Errorf("decode schema reference %s: %w", ref, err)
				}
				if err := resolver.register(targetPath, loaded); err != nil {
					return nil, "", nil, "", err
				}
			}
			targetRoot = loaded
		}
	}
	target := targetRoot
	if fragment != "" {
		decoded, err := url.PathUnescape(fragment)
		if err != nil {
			return nil, "", nil, "", fmt.Errorf("%w: invalid schema reference fragment", ErrInvalidSchema)
		}
		target, err = jsonPointer(targetRoot, decoded)
		if err != nil {
			return nil, "", nil, "", fmt.Errorf("resolve schema reference %s: %w", ref, err)
		}
	}
	return target, targetPath, targetRoot, fragment, nil
}

func normalizeSchemaPath(path string) (string, error) {
	if filepath.IsAbs(path) {
		return "", fmt.Errorf("%w: schema path must be project-relative", ErrInvalidSchema)
	}
	clean := filepath.ToSlash(filepath.Clean(path))
	if clean == "." || clean == ".." || strings.HasPrefix(clean, "../") {
		return "", fmt.Errorf("%w: schema path escapes project", ErrInvalidSchema)
	}
	return clean, nil
}

func jsonPointer(value any, pointer string) (any, error) {
	if pointer == "" {
		return value, nil
	}
	if !strings.HasPrefix(pointer, "/") {
		return nil, errors.New("JSON Pointer must start with /")
	}
	current := value
	for _, rawPart := range strings.Split(strings.TrimPrefix(pointer, "/"), "/") {
		part := strings.ReplaceAll(strings.ReplaceAll(rawPart, "~1", "/"), "~0", "~")
		switch typed := current.(type) {
		case map[string]any:
			next, ok := typed[part]
			if !ok {
				return nil, fmt.Errorf("pointer segment %s not found", part)
			}
			current = next
		case []any:
			index, err := strconv.Atoi(part)
			if err != nil || index < 0 || index >= len(typed) {
				return nil, fmt.Errorf("pointer index %s is invalid", part)
			}
			current = typed[index]
		default:
			return nil, fmt.Errorf("pointer segment %s traverses a scalar", part)
		}
	}
	return current, nil
}

func cloneObject(value map[string]any) map[string]any {
	result := make(map[string]any, len(value))
	for key, child := range value {
		result[key] = child
	}
	return result
}

func redactSchema(value any, propertyName string) any {
	switch typed := value.(type) {
	case []any:
		result := make([]any, len(typed))
		for index, child := range typed {
			result[index] = redactSchema(child, propertyName)
		}
		return result
	case map[string]any:
		result := make(map[string]any, len(typed))
		sensitive := isSensitive(typed, propertyName)
		for key, child := range typed {
			if sensitive && (key == "default" || key == "const" || key == "example" || key == "examples" || key == "enum") {
				continue
			}
			result[key] = redactSchema(child, key)
		}
		return result
	default:
		return value
	}
}

func redactValue(value any, schema any, propertyName ...string) any {
	name := ""
	if len(propertyName) > 0 {
		name = propertyName[0]
	}
	if isSensitive(schema, name) {
		return nil
	}
	schemaObject, schemaOK := schema.(map[string]any)
	object, objectOK := value.(map[string]any)
	if schemaOK && objectOK {
		result := make(map[string]any, len(object))
		for key, child := range object {
			result[key] = redactValue(child, redactionPropertySchema(schemaObject, key, 0), key)
		}
		return result
	}
	if values, ok := value.([]any); ok && schemaOK {
		items := redactionArrayItemSchema(schemaObject, 0)
		result := make([]any, len(values))
		for index, child := range values {
			result[index] = redactValue(child, items, name)
		}
		return result
	}
	return value
}

func propertySchema(schema map[string]any, name string) any {
	if properties, ok := schema["properties"].(map[string]any); ok {
		if candidate, declared := properties[name]; declared {
			return candidate
		}
	}
	if candidate, matched := patternPropertySchema(schema, name); matched {
		return candidate
	}
	additional, exists := schema["additionalProperties"]
	if !exists {
		return nil
	}
	if allowed, ok := additional.(bool); ok {
		if allowed {
			return nil
		}
		return nil
	}
	return additional
}

func redactionPropertySchema(schema map[string]any, name string, depth int) any {
	if depth > 32 {
		return map[string]any{"x-sensitive": true}
	}
	candidates := make([]any, 0, 4)
	if properties, ok := schema["properties"].(map[string]any); ok {
		if candidate, exists := properties[name]; exists {
			candidates = append(candidates, candidate)
		}
	}
	if candidate, matched := patternPropertySchema(schema, name); matched {
		candidates = append(candidates, candidate)
	}
	if additional, ok := schema["additionalProperties"].(map[string]any); ok {
		candidates = append(candidates, additional)
	}
	for _, keyword := range []string{"allOf", "anyOf", "oneOf"} {
		branchesValue, exists := schema[keyword]
		if !exists {
			continue
		}
		branches, err := schemaBranches(branchesValue)
		if err != nil {
			return map[string]any{"x-sensitive": true}
		}
		for _, rawBranch := range branches {
			branch, ok := rawBranch.(map[string]any)
			if !ok {
				return map[string]any{"x-sensitive": true}
			}
			if candidate := redactionPropertySchema(branch, name, depth+1); candidate != nil {
				candidates = append(candidates, candidate)
			}
		}
	}
	return combineRedactionSchemas(candidates, name)
}

func redactionArrayItemSchema(schema map[string]any, depth int) any {
	if depth > 32 {
		return map[string]any{"x-sensitive": true}
	}
	candidates := make([]any, 0, 4)
	if items, exists := schema["items"]; exists {
		candidates = append(candidates, items)
	}
	for _, keyword := range []string{"allOf", "anyOf", "oneOf"} {
		branchesValue, exists := schema[keyword]
		if !exists {
			continue
		}
		branches, err := schemaBranches(branchesValue)
		if err != nil {
			return map[string]any{"x-sensitive": true}
		}
		for _, rawBranch := range branches {
			branch, ok := rawBranch.(map[string]any)
			if !ok {
				return map[string]any{"x-sensitive": true}
			}
			if candidate := redactionArrayItemSchema(branch, depth+1); candidate != nil {
				candidates = append(candidates, candidate)
			}
		}
	}
	return combineRedactionSchemas(candidates, "")
}

func combineRedactionSchemas(candidates []any, propertyName string) any {
	if len(candidates) == 0 {
		return nil
	}
	for _, candidate := range candidates {
		if redactionSchemaContainsSensitive(candidate, propertyName, 0) {
			return map[string]any{"x-sensitive": true}
		}
	}
	if len(candidates) == 1 {
		return candidates[0]
	}
	return map[string]any{"allOf": candidates}
}

func redactionSchemaContainsSensitive(schema any, propertyName string, depth int) bool {
	if depth > 32 {
		return true
	}
	object, ok := schema.(map[string]any)
	if !ok {
		return true
	}
	if isSensitive(object, propertyName) {
		return true
	}
	for _, keyword := range []string{"allOf", "anyOf", "oneOf"} {
		branchesValue, exists := object[keyword]
		if !exists {
			continue
		}
		branches, err := schemaBranches(branchesValue)
		if err != nil {
			return true
		}
		for _, branch := range branches {
			if redactionSchemaContainsSensitive(branch, propertyName, depth+1) {
				return true
			}
		}
	}
	return false
}

func mergeSafe(current, patch, schema any) (any, error) {
	if isSensitive(schema, "") {
		return nil, ErrSensitiveField
	}
	schemaObject, schemaOK := schema.(map[string]any)
	if !schemaOK {
		return nil, ErrInvalidSchema
	}
	if readOnly, exists := schemaObject["readOnly"].(bool); exists && readOnly {
		return nil, ErrUnsupportedPatch
	}
	if schemaObject["x-studio-json-value"] == true {
		return markedJSONValue(patch)
	}
	if schemaObject["x-studio-json-document"] == true {
		patchObject, ok := patch.(map[string]any)
		if !ok || len(patchObject) != 1 {
			return nil, ErrUnsupportedPatch
		}
		document, exists := patchObject[configurationJSONDocumentKey]
		if !exists {
			return nil, ErrUnsupportedPatch
		}
		if _, ok = document.(map[string]any); !ok {
			return nil, ErrUnsupportedPatch
		}
		if err := validateJSONDocument(document, 0, new(int)); err != nil {
			return nil, err
		}
		return document, nil
	}
	if schemaObject["x-studio-json-document"] == true {
		patchObject, ok := patch.(map[string]any)
		if !ok || len(patchObject) != 1 {
			return nil, ErrUnsupportedPatch
		}
		document, exists := patchObject[configurationJSONDocumentKey]
		if !exists {
			return nil, ErrUnsupportedPatch
		}
		if err := validateJSONDocument(document, 0, new(int)); err != nil {
			return nil, err
		}
		return document, nil
	}
	if patchObject, ok := patch.(map[string]any); ok {
		for _, keyword := range []string{"oneOf", "anyOf"} {
			branchesValue, exists := schemaObject[keyword]
			if !exists {
				continue
			}
			return mergeSafeComposition(current, patchObject, schema, branchesValue)
		}
	}
	schemaType, schemaTypeOK := schemaObject["type"].(string)
	if schemaTypeOK && schemaType == "array" {
		itemSchema, exists := schemaObject["items"]
		if !exists {
			return nil, ErrInvalidSchema
		}
		if patchArray, ok := patch.([]any); ok {
			if containsProtectedConfigurationField(itemSchema, "", 0) {
				return nil, ErrSensitiveField
			}
			normalized := make([]any, len(patchArray))
			for index, item := range patchArray {
				value, normalizeErr := normalizeJSONDocumentValues(item, itemSchema, 0)
				if normalizeErr != nil {
					return nil, normalizeErr
				}
				normalized[index] = value
			}
			return normalized, nil
		}
		patchObject, ok := patch.(map[string]any)
		if !ok {
			return nil, ErrUnsupportedPatch
		}
		currentArray, ok := current.([]any)
		if !ok {
			return nil, ErrUnsupportedPatch
		}
		if _, exists := patchObject[protectedArrayOperationsKey]; exists {
			operations, decodeErr := decodeProtectedArrayOperations(patchObject, itemSchema)
			if decodeErr != nil {
				return nil, decodeErr
			}
			return applyProtectedArrayOperations(currentArray, operations, schemaObject, itemSchema)
		}
		merged := append([]any(nil), currentArray...)
		for rawIndex, child := range patchObject {
			index, err := parseArrayPatchIndex(rawIndex)
			if err != nil {
				return nil, err
			}
			if index >= len(merged) {
				return nil, fmt.Errorf("%w: array index %s is out of range", ErrUnsupportedPatch, rawIndex)
			}
			if _, partialObject := child.(map[string]any); partialObject {
				value, mergeErr := mergeSafe(merged[index], child, itemSchema)
				if mergeErr != nil {
					return nil, mergeErr
				}
				merged[index] = value
				continue
			}
			if containsProtectedConfigurationField(itemSchema, "", 0) {
				return nil, ErrSensitiveField
			}
			merged[index] = child
		}
		return merged, nil
	}
	patchObject, patchOK := patch.(map[string]any)
	if !patchOK {
		return nil, ErrUnsupportedPatch
	}
	currentObject, currentOK := current.(map[string]any)
	if !currentOK {
		currentObject = map[string]any{}
	}
	properties, propertiesOK := schemaObject["properties"].(map[string]any)
	if !propertiesOK {
		properties = map[string]any{}
	}
	if _, exists := patchObject[configurationMapOperationsKey]; exists {
		operations, decodeErr := decodeConfigurationMapOperations(patchObject, schemaObject)
		if decodeErr != nil {
			return nil, decodeErr
		}
		cloned, cloneErr := cloneSettingsValue(currentObject)
		if cloneErr != nil {
			return nil, cloneErr
		}
		currentObject, currentOK = cloned.(map[string]any)
		if !currentOK {
			return nil, ErrUnsupportedPatch
		}
		for _, operation := range operations {
			if _, exists := currentObject[operation.key]; !exists {
				return nil, fmt.Errorf("%w: map key %s is unavailable", ErrUnsupportedPatch, operation.key)
			}
			delete(currentObject, operation.key)
		}
	}
	for key, child := range patchObject {
		if key == configurationMapOperationsKey {
			continue
		}
		childSchema, declared := properties[key]
		if !declared {
			if patternSchema, matched := patternPropertySchema(schemaObject, key); matched {
				childSchema = patternSchema
				declared = true
			}
		}
		if !declared {
			additional, hasAdditional := schemaObject["additionalProperties"]
			if !hasAdditional {
				return nil, fmt.Errorf("%w: %s", ErrUnsupportedPatch, key)
			}
			if allowed, ok := additional.(bool); ok {
				if !allowed {
					return nil, fmt.Errorf("%w: %s", ErrUnsupportedPatch, key)
				}
				if isSensitive(nil, key) {
					return nil, fmt.Errorf("%w: %s", ErrSensitiveField, key)
				}
				currentObject[key] = child
				continue
			}
			if _, ok := additional.(map[string]any); !ok {
				return nil, fmt.Errorf("%w: additionalProperties", ErrInvalidSchema)
			}
			childSchema = additional
		}
		if isSensitive(childSchema, key) {
			return nil, fmt.Errorf("%w: %s", ErrSensitiveField, key)
		}
		if childObject, ok := childSchema.(map[string]any); ok {
			if readOnly, readOnlyOK := childObject["readOnly"].(bool); readOnlyOK && readOnly {
				return nil, fmt.Errorf("%w: %s is read-only", ErrUnsupportedPatch, key)
			}
		}
		if _, isObject := child.(map[string]any); isObject {
			merged, err := mergeSafe(currentObject[key], child, childSchema)
			if err != nil {
				return nil, err
			}
			currentObject[key] = merged
			continue
		}
		if _, isArray := child.([]any); isArray {
			merged, err := mergeSafe(currentObject[key], child, childSchema)
			if err != nil {
				return nil, err
			}
			currentObject[key] = merged
			continue
		}
		if containsProtectedConfigurationField(childSchema, key, 0) {
			return nil, fmt.Errorf("%w: %s", ErrSensitiveField, key)
		}
		currentObject[key] = child
	}
	return currentObject, nil
}

func normalizeJSONDocumentValues(value, schema any, depth int) (any, error) {
	if depth > 64 {
		return nil, ErrInvalidSchema
	}
	schemaObject, ok := schema.(map[string]any)
	if !ok {
		return value, nil
	}
	if schemaObject["x-studio-json-value"] == true {
		return markedJSONValue(value)
	}
	if schemaObject["x-studio-json-document"] == true {
		patch, ok := value.(map[string]any)
		if !ok || len(patch) != 1 {
			return nil, ErrUnsupportedPatch
		}
		document, exists := patch[configurationJSONDocumentKey]
		if !exists {
			return nil, ErrUnsupportedPatch
		}
		if _, ok := document.(map[string]any); !ok {
			return nil, ErrUnsupportedPatch
		}
		if err := validateJSONDocument(document, 0, new(int)); err != nil {
			return nil, err
		}
		return document, nil
	}
	if object, ok := value.(map[string]any); ok {
		properties := map[string]any{}
		if raw, exists := schemaObject["properties"]; exists {
			var valid bool
			properties, valid = raw.(map[string]any)
			if !valid {
				return nil, ErrInvalidSchema
			}
		}
		var additional any
		if raw, exists := schemaObject["additionalProperties"]; exists {
			switch value := raw.(type) {
			case map[string]any:
				additional = value
			case bool:
			case nil:
			default:
				return nil, ErrInvalidSchema
			}
		}
		result := make(map[string]any, len(object))
		for key, child := range object {
			childSchema, declared := properties[key]
			if !declared {
				childSchema = additional
			}
			normalized, err := normalizeJSONDocumentValues(child, childSchema, depth+1)
			if err != nil {
				return nil, err
			}
			result[key] = normalized
		}
		return result, nil
	}
	if values, ok := value.([]any); ok {
		itemSchema, exists := schemaObject["items"]
		if !exists {
			return nil, ErrInvalidSchema
		}
		result := make([]any, len(values))
		for index, child := range values {
			normalized, err := normalizeJSONDocumentValues(child, itemSchema, depth+1)
			if err != nil {
				return nil, err
			}
			result[index] = normalized
		}
		return result, nil
	}
	return value, nil
}

func decodeConfigurationMapOperations(patch, schema map[string]any) ([]configurationMapOperation, error) {
	raw, exists := patch[configurationMapOperationsKey]
	if !exists {
		return nil, ErrUnsupportedPatch
	}
	if _, hasPatterns := schema["patternProperties"]; schema["type"] != "object" || hasPatterns {
		return nil, fmt.Errorf("%w: map operation schema is unsupported", ErrUnsupportedPatch)
	}
	if _, hasNames := schema["propertyNames"]; hasNames {
		return nil, fmt.Errorf("%w: map operation schema is unsupported", ErrUnsupportedPatch)
	}
	if _, hasDependencies := schema["dependentSchemas"]; hasDependencies {
		return nil, fmt.Errorf("%w: map operation schema is unsupported", ErrUnsupportedPatch)
	}
	additional, ok := schema["additionalProperties"].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("%w: map operations require typed additionalProperties", ErrUnsupportedPatch)
	}
	if containsProtectedConfigurationField(additional, "", 0) {
		return nil, ErrSensitiveField
	}
	items, ok := raw.([]any)
	if !ok || len(items) == 0 || len(items) > 1024 {
		return nil, fmt.Errorf("%w: map operations must contain 1..1024 items", ErrUnsupportedPatch)
	}
	properties, propertiesOK := schema["properties"].(map[string]any)
	if !propertiesOK {
		properties = map[string]any{}
	}
	seen := make(map[string]struct{}, len(items))
	operations := make([]configurationMapOperation, 0, len(items))
	for _, rawOperation := range items {
		operation, valid := rawOperation.(map[string]any)
		if !valid || len(operation) != 2 {
			return nil, fmt.Errorf("%w: malformed map operation", ErrUnsupportedPatch)
		}
		kind, kindOK := operation["op"].(string)
		key, keyOK := operation["key"].(string)
		if !kindOK || kind != "remove" || !keyOK || !safeConfigurationMapKey(key) {
			return nil, fmt.Errorf("%w: invalid map operation", ErrUnsupportedPatch)
		}
		if _, declared := properties[key]; declared {
			return nil, fmt.Errorf("%w: declared map property %s cannot be removed dynamically", ErrUnsupportedPatch, key)
		}
		if _, duplicate := seen[key]; duplicate {
			return nil, fmt.Errorf("%w: duplicate map operation for %s", ErrUnsupportedPatch, key)
		}
		seen[key] = struct{}{}
		operations = append(operations, configurationMapOperation{operation: kind, key: key})
	}
	for key := range patch {
		if key == configurationMapOperationsKey || isSensitive(additional, key) {
			continue
		}
		if _, removed := seen[key]; removed {
			return nil, fmt.Errorf("%w: map key %s is both removed and edited", ErrUnsupportedPatch, key)
		}
	}
	return operations, nil
}

func safeConfigurationMapKey(key string) bool {
	if key == "" || utf8.RuneCountInString(key) > 128 || key == configurationMapOperationsKey {
		return false
	}
	if key == "__proto__" || key == "prototype" || key == "constructor" {
		return false
	}
	return !isSensitive(nil, key)
}

func decodeProtectedArrayOperations(patch map[string]any, itemSchema any) ([]protectedArrayOperation, error) {
	raw, exists := patch[protectedArrayOperationsKey]
	if !exists {
		return nil, ErrUnsupportedPatch
	}
	if len(patch) != 1 {
		return nil, ErrUnsupportedPatch
	}
	items, ok := raw.([]any)
	if !ok || len(items) == 0 || len(items) > 1024 {
		return nil, ErrUnsupportedPatch
	}
	operations := make([]protectedArrayOperation, 0, len(items))
	for _, rawOperation := range items {
		object, ok := rawOperation.(map[string]any)
		if !ok {
			return nil, ErrUnsupportedPatch
		}
		kind, ok := object["op"].(string)
		if !ok {
			return nil, ErrUnsupportedPatch
		}
		operation := protectedArrayOperation{}
		switch kind {
		case "insert":
			operation.kind = protectedArrayInsert
			if len(object) != 3 {
				return nil, ErrUnsupportedPatch
			}
			index, indexErr := protectedArrayIndex(object["index"])
			value, valueOK := object["value"]
			if indexErr != nil || !valueOK {
				return nil, ErrUnsupportedPatch
			}
			if err := validatePatchSafety(value, itemSchema, ""); err != nil {
				return nil, err
			}
			operation.first = index
			operation.value = value
		case "set":
			operation.kind = protectedArraySet
			if len(object) != 3 {
				return nil, ErrUnsupportedPatch
			}
			index, indexErr := protectedArrayIndex(object["index"])
			value, valueOK := object["patch"].(map[string]any)
			if indexErr != nil || !valueOK || len(value) == 0 {
				return nil, ErrUnsupportedPatch
			}
			if err := validatePatchSafety(value, itemSchema, ""); err != nil {
				return nil, err
			}
			operation.first = index
			operation.patch = value
		case "remove":
			operation.kind = protectedArrayRemove
			if len(object) != 2 {
				return nil, ErrUnsupportedPatch
			}
			index, indexErr := protectedArrayIndex(object["index"])
			if indexErr != nil {
				return nil, indexErr
			}
			operation.first = index
		case "move":
			operation.kind = protectedArrayMove
			if len(object) != 3 {
				return nil, ErrUnsupportedPatch
			}
			from, fromErr := protectedArrayIndex(object["from"])
			to, toErr := protectedArrayIndex(object["to"])
			if fromErr != nil || toErr != nil {
				return nil, ErrUnsupportedPatch
			}
			operation.first, operation.second = from, to
		case "duplicate":
			operation.kind = protectedArrayDuplicate
			if len(object) != 3 {
				return nil, ErrUnsupportedPatch
			}
			index, indexErr := protectedArrayIndex(object["index"])
			to, toErr := protectedArrayIndex(object["to"])
			if indexErr != nil || toErr != nil {
				return nil, ErrUnsupportedPatch
			}
			operation.first, operation.second = index, to
		default:
			return nil, ErrUnsupportedPatch
		}
		operations = append(operations, operation)
	}
	return operations, nil
}

func protectedArrayIndex(value any) (int, error) {
	number, ok := value.(float64)
	if !ok || math.IsNaN(number) || math.IsInf(number, 0) || number < 0 || number > 1_000_000 || math.Trunc(number) != number {
		return 0, ErrUnsupportedPatch
	}
	return int(number), nil
}

func applyProtectedArrayOperations(current []any, operations []protectedArrayOperation, schema, itemSchema any) ([]any, error) {
	result := append([]any(nil), current...)
	minimum := schemaInteger(schema, "minItems", 0)
	maximum := schemaInteger(schema, "maxItems", 1_000_000)
	for _, operation := range operations {
		switch operation.kind {
		case protectedArrayInsert:
			if operation.first > len(result) || len(result) >= maximum {
				return nil, ErrUnsupportedPatch
			}
			value, err := mergeSafe(nil, operation.value, itemSchema)
			if err != nil {
				return nil, err
			}
			result = append(result, nil)
			copy(result[operation.first+1:], result[operation.first:])
			result[operation.first] = value
		case protectedArraySet:
			if operation.first >= len(result) {
				return nil, ErrUnsupportedPatch
			}
			updated, err := mergeSafe(result[operation.first], operation.patch, itemSchema)
			if err != nil {
				return nil, err
			}
			result[operation.first] = updated
		case protectedArrayRemove:
			if operation.first >= len(result) || len(result)-1 < minimum {
				return nil, ErrUnsupportedPatch
			}
			result = append(result[:operation.first], result[operation.first+1:]...)
		case protectedArrayMove:
			if operation.first >= len(result) || operation.second >= len(result) {
				return nil, ErrUnsupportedPatch
			}
			if operation.first != operation.second {
				item := result[operation.first]
				result = append(result[:operation.first], result[operation.first+1:]...)
				result = append(result, nil)
				copy(result[operation.second+1:], result[operation.second:])
				result[operation.second] = item
			}
		case protectedArrayDuplicate:
			if operation.first >= len(result) || operation.second > len(result) || len(result) >= maximum {
				return nil, ErrUnsupportedPatch
			}
			item, err := cloneSettingsValue(result[operation.first])
			if err != nil {
				return nil, err
			}
			result = append(result, nil)
			copy(result[operation.second+1:], result[operation.second:])
			result[operation.second] = item
		}
	}
	return result, nil
}

func schemaInteger(value any, key string, fallback int) int {
	object, ok := value.(map[string]any)
	if !ok {
		return fallback
	}
	number, ok := object[key].(float64)
	if !ok || number < 0 || number > 1_000_000 || math.Trunc(number) != number {
		return fallback
	}
	return int(number)
}

func mergeSafeComposition(current any, patch map[string]any, schema, branchesValue any) (any, error) {
	branches, err := schemaBranches(branchesValue)
	if err != nil {
		return nil, err
	}
	type candidate struct {
		value   any
		matches bool
	}
	candidates := make([]candidate, 0, len(branches))
	for _, branch := range branches {
		currentCopy, cloneErr := cloneSettingsValue(current)
		if cloneErr != nil {
			return nil, cloneErr
		}
		merged, mergeErr := mergeSafe(currentCopy, patch, branch)
		if mergeErr != nil {
			continue
		}
		candidates = append(candidates, candidate{
			value:   merged,
			matches: validateValue(merged, schema, "$candidate") == nil,
		})
	}
	if len(candidates) == 0 {
		return nil, ErrUnsupportedPatch
	}
	var matching []any
	for _, option := range candidates {
		if option.matches {
			matching = append(matching, option.value)
		}
	}
	if len(matching) == 1 {
		return matching[0], nil
	}
	if len(matching) > 1 {
		if allEqual(matching) {
			return matching[0], nil
		}
		return nil, ErrUnsupportedPatch
	}
	values := make([]any, len(candidates))
	for index, option := range candidates {
		values[index] = option.value
	}
	if allEqual(values) {
		return values[0], nil
	}
	if len(candidates) == 1 {
		return candidates[0].value, nil
	}
	return nil, ErrUnsupportedPatch
}

func cloneSettingsValue(value any) (any, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var clone any
	if err := json.Unmarshal(data, &clone); err != nil {
		return nil, err
	}
	return clone, nil
}

func allEqual(values []any) bool {
	if len(values) < 2 {
		return true
	}
	for _, value := range values[1:] {
		if !reflect.DeepEqual(values[0], value) {
			return false
		}
	}
	return true
}

func containsProtectedConfigurationField(schema any, propertyName string, depth int) bool {
	if depth > 64 {
		return true
	}
	object, ok := schema.(map[string]any)
	if !ok {
		return true
	}
	if isSensitive(object, propertyName) {
		return true
	}
	if readOnly, exists := object["readOnly"].(bool); exists && readOnly {
		return true
	}
	if writeOnly, exists := object["writeOnly"].(bool); exists && writeOnly {
		return true
	}
	if properties, exists := object["properties"]; exists {
		propertyMap, valid := properties.(map[string]any)
		if !valid {
			return true
		}
		for name, child := range propertyMap {
			if containsProtectedConfigurationField(child, name, depth+1) {
				return true
			}
		}
	}
	if items, exists := object["items"]; exists && containsProtectedConfigurationField(items, propertyName, depth+1) {
		return true
	}
	if additional, exists := object["additionalProperties"]; exists {
		if additionalSchema, isSchema := additional.(map[string]any); isSchema && containsProtectedConfigurationField(additionalSchema, propertyName, depth+1) {
			return true
		}
	}
	for _, keyword := range []string{"allOf", "anyOf", "oneOf"} {
		branchesValue, exists := object[keyword]
		if !exists {
			continue
		}
		branches, err := schemaBranches(branchesValue)
		if err != nil {
			return true
		}
		for _, branch := range branches {
			if containsProtectedConfigurationField(branch, propertyName, depth+1) {
				return true
			}
		}
	}
	return false
}

func parseArrayPatchIndex(value string) (int, error) {
	if value == "" || (len(value) > 1 && value[0] == '0') {
		return 0, fmt.Errorf("%w: invalid array index %q", ErrUnsupportedPatch, value)
	}
	for _, char := range value {
		if char < '0' || char > '9' {
			return 0, fmt.Errorf("%w: invalid array index %q", ErrUnsupportedPatch, value)
		}
	}
	index, err := strconv.Atoi(value)
	if err != nil || index < 0 {
		return 0, fmt.Errorf("%w: invalid array index %q", ErrUnsupportedPatch, value)
	}
	return index, nil
}

func isSensitive(schema any, propertyName string) bool {
	object, ok := schema.(map[string]any)
	if ok {
		for _, key := range []string{"x-sensitive", "x-secret", "x-redacted", "x-liapoldus-sensitive"} {
			if sensitive, exists := object[key].(bool); exists && sensitive {
				return true
			}
		}
		if writeOnly, exists := object["writeOnly"].(bool); exists && writeOnly {
			return true
		}
		if format, exists := object["format"].(string); exists && format == "password" {
			return true
		}
	}
	name := strings.ToLower(propertyName)
	for _, marker := range []string{"secret", "token", "password", "privatekey", "authorization"} {
		if strings.Contains(name, marker) {
			return true
		}
	}
	return false
}

// validateValue intentionally implements the schema subset that Studio can
// render and safely persist. The CLI/runtime remain the final authority, but
// rejecting invalid values here prevents the desktop host from producing a
// project that is structurally invalid between edits.
func validateValue(value, schema any, path string) error {
	object, ok := schema.(map[string]any)
	if !ok {
		return ErrInvalidSchema
	}
	if branches, exists := object["allOf"]; exists {
		items, err := schemaBranches(branches)
		if err != nil {
			return err
		}
		for _, branch := range items {
			if err := validateValue(value, branch, path); err != nil {
				return err
			}
		}
	}
	for _, keyword := range []string{"anyOf", "oneOf"} {
		if branches, exists := object[keyword]; exists {
			items, err := schemaBranches(branches)
			if err != nil {
				return err
			}
			matches := 0
			for _, branch := range items {
				if validateValue(value, branch, path) == nil {
					matches++
				}
			}
			valid := matches > 0
			if keyword == "oneOf" {
				valid = matches == 1
			}
			if !valid {
				return fmt.Errorf("%w: %s does not satisfy %s", ErrUnsupportedPatch, path, keyword)
			}
		}
	}
	if notSchema, exists := object["not"]; exists && validateValue(value, notSchema, path) == nil {
		return fmt.Errorf("%w: %s matches forbidden schema", ErrUnsupportedPatch, path)
	}
	if enum, exists := object["enum"]; exists {
		values, ok := enum.([]any)
		if !ok || !containsValue(values, value) {
			return fmt.Errorf("%w: %s must be one of enum values", ErrUnsupportedPatch, path)
		}
	}
	if constant, exists := object["const"]; exists && !reflect.DeepEqual(constant, value) {
		return fmt.Errorf("%w: %s must equal const", ErrUnsupportedPatch, path)
	}
	if value == nil {
		nullable, nullableOK := object["nullable"].(bool)
		if (nullableOK && nullable) || schemaAllowsNull(object["type"]) {
			return nil
		}
		return fmt.Errorf("%w: %s must not be null", ErrUnsupportedPatch, path)
	}
	if typeName, exists := object["type"]; exists {
		if !matchesType(value, typeName) {
			return fmt.Errorf("%w: %s has an invalid type", ErrUnsupportedPatch, path)
		}
	}

	switch typed := value.(type) {
	case map[string]any:
		properties, propertiesOK := object["properties"].(map[string]any)
		if !propertiesOK {
			properties = map[string]any{}
		}
		if required, exists := object["required"]; exists {
			items, ok := required.([]any)
			if !ok {
				return ErrInvalidSchema
			}
			for _, item := range items {
				name, ok := item.(string)
				if !ok {
					return ErrInvalidSchema
				}
				if _, present := typed[name]; !present {
					return fmt.Errorf("%w: %s.%s is required", ErrUnsupportedPatch, path, name)
				}
			}
		}
		if limit, exists := integerConstraint(object, "minProperties"); exists && len(typed) < limit {
			return fmt.Errorf("%w: %s has too few properties", ErrUnsupportedPatch, path)
		}
		if limit, exists := integerConstraint(object, "maxProperties"); exists && len(typed) > limit {
			return fmt.Errorf("%w: %s has too many properties", ErrUnsupportedPatch, path)
		}
		if err := validatePatternProperties(object); err != nil {
			return err
		}
		for name, child := range typed {
			childSchema, declared := properties[name]
			if !declared {
				if patternSchema, matched := patternPropertySchema(object, name); matched {
					if err := validateValue(child, patternSchema, path+"."+name); err != nil {
						return err
					}
					continue
				}
				additional, hasAdditional := object["additionalProperties"]
				if !hasAdditional {
					continue
				}
				if allowed, ok := additional.(bool); ok {
					if !allowed {
						return fmt.Errorf("%w: %s.%s is not declared", ErrUnsupportedPatch, path, name)
					}
					continue
				}
				additionalSchema, ok := additional.(map[string]any)
				if !ok {
					return fmt.Errorf("%w: additionalProperties", ErrInvalidSchema)
				}
				if err := validateValue(child, additionalSchema, path+"."+name); err != nil {
					return err
				}
				continue
			}
			if patternSchema, matched := patternPropertySchema(object, name); matched {
				if err := validateValue(child, patternSchema, path+"."+name); err != nil {
					return err
				}
			}
			if err := validateValue(child, childSchema, path+"."+name); err != nil {
				return err
			}
		}
		if propertyNames, exists := object["propertyNames"]; exists {
			for name := range typed {
				if err := validateValue(name, propertyNames, path+".<property-name>"); err != nil {
					return err
				}
			}
		}
		if dependencies, exists := object["dependentRequired"]; exists {
			dependencyMap, ok := dependencies.(map[string]any)
			if !ok {
				return ErrInvalidSchema
			}
			for name, dependency := range dependencyMap {
				if _, present := typed[name]; !present {
					continue
				}
				required, ok := dependency.([]any)
				if !ok {
					return ErrInvalidSchema
				}
				for _, item := range required {
					dependencyName, ok := item.(string)
					if !ok {
						return ErrInvalidSchema
					}
					if _, present := typed[dependencyName]; !present {
						return fmt.Errorf("%w: %s.%s requires %s", ErrUnsupportedPatch, path, name, dependencyName)
					}
				}
			}
		}
	case []any:
		if limit, exists := integerConstraint(object, "minItems"); exists && len(typed) < limit {
			return fmt.Errorf("%w: %s has too few items", ErrUnsupportedPatch, path)
		}
		if limit, exists := integerConstraint(object, "maxItems"); exists && len(typed) > limit {
			return fmt.Errorf("%w: %s has too many items", ErrUnsupportedPatch, path)
		}
		if unique, exists := object["uniqueItems"].(bool); exists && unique && !uniqueValues(typed) {
			return fmt.Errorf("%w: %s contains duplicate items", ErrUnsupportedPatch, path)
		}
		if itemSchema, exists := object["items"]; exists {
			for index, child := range typed {
				if err := validateValue(child, itemSchema, fmt.Sprintf("%s[%d]", path, index)); err != nil {
					return err
				}
			}
		}
	case string:
		if limit, exists := integerConstraint(object, "minLength"); exists && len([]rune(typed)) < limit {
			return fmt.Errorf("%w: %s is too short", ErrUnsupportedPatch, path)
		}
		if limit, exists := integerConstraint(object, "maxLength"); exists && len([]rune(typed)) > limit {
			return fmt.Errorf("%w: %s is too long", ErrUnsupportedPatch, path)
		}
		if pattern, exists := object["pattern"].(string); exists {
			expression, err := regexp.Compile(pattern)
			if err != nil {
				return fmt.Errorf("%w: invalid pattern for %s", ErrInvalidSchema, path)
			}
			if !expression.MatchString(typed) {
				return fmt.Errorf("%w: %s does not match pattern", ErrUnsupportedPatch, path)
			}
		}
	case float64:
		if minimum, exists := numberConstraint(object, "minimum"); exists && typed < minimum {
			return fmt.Errorf("%w: %s is below minimum", ErrUnsupportedPatch, path)
		}
		if minimum, exists := exclusiveNumberConstraint(object, "exclusiveMinimum", "minimum"); exists && typed <= minimum {
			return fmt.Errorf("%w: %s is not above exclusive minimum", ErrUnsupportedPatch, path)
		}
		if maximum, exists := numberConstraint(object, "maximum"); exists && typed > maximum {
			return fmt.Errorf("%w: %s is above maximum", ErrUnsupportedPatch, path)
		}
		if maximum, exists := exclusiveNumberConstraint(object, "exclusiveMaximum", "maximum"); exists && typed >= maximum {
			return fmt.Errorf("%w: %s is not below exclusive maximum", ErrUnsupportedPatch, path)
		}
		if multiple, exists := numberConstraint(object, "multipleOf"); exists && multiple > 0 && !isMultipleOf(typed, multiple) {
			return fmt.Errorf("%w: %s is not a multiple of %v", ErrUnsupportedPatch, path, multiple)
		}
		typeName, typeNameOK := object["type"].(string)
		if typeNameOK && typeName == "integer" && typed != float64(int64(typed)) {
			return fmt.Errorf("%w: %s must be an integer", ErrUnsupportedPatch, path)
		}
	}
	return nil
}

func containsValue(values []any, target any) bool {
	for _, value := range values {
		if reflect.DeepEqual(value, target) {
			return true
		}
	}
	return false
}

func uniqueValues(values []any) bool {
	for index, value := range values {
		for _, other := range values[index+1:] {
			if reflect.DeepEqual(value, other) {
				return false
			}
		}
	}
	return true
}

func isMultipleOf(value, divisor float64) bool {
	quotient := value / divisor
	return math.Abs(quotient-math.Round(quotient)) < 1e-9
}

func patternPropertySchema(schema map[string]any, name string) (any, bool) {
	patterns, ok := schema["patternProperties"].(map[string]any)
	if !ok {
		return nil, false
	}
	for pattern, candidate := range patterns {
		expression, err := regexp.Compile(pattern)
		if err != nil {
			return nil, false
		}
		if expression.MatchString(name) {
			return candidate, true
		}
	}
	return nil, false
}

func validatePatternProperties(schema map[string]any) error {
	patterns, ok := schema["patternProperties"].(map[string]any)
	if !ok {
		return nil
	}
	for pattern, candidate := range patterns {
		if _, err := regexp.Compile(pattern); err != nil {
			return fmt.Errorf("%w: invalid patternProperties pattern %s", ErrInvalidSchema, pattern)
		}
		if _, ok := candidate.(map[string]any); !ok {
			return ErrInvalidSchema
		}
	}
	return nil
}

func exclusiveNumberConstraint(schema map[string]any, exclusiveKey, minimumKey string) (float64, bool) {
	value := schema[exclusiveKey]
	if numeric, numericOK := value.(float64); numericOK {
		return numeric, true
	}
	if enabled, enabledOK := value.(bool); enabledOK && enabled {
		return numberConstraint(schema, minimumKey)
	}
	return 0, false
}

func schemaList(value any) []any {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	return items
}

func schemaBranches(value any) ([]any, error) {
	items, ok := value.([]any)
	if !ok || len(items) == 0 {
		return nil, ErrInvalidSchema
	}
	for _, item := range items {
		if _, ok := item.(map[string]any); !ok {
			return nil, ErrInvalidSchema
		}
	}
	return items, nil
}

func schemaAllowsNull(value any) bool {
	if typeName, ok := value.(string); ok {
		return typeName == "null"
	}
	for _, item := range schemaList(value) {
		if name, ok := item.(string); ok && name == "null" {
			return true
		}
	}
	return false
}

func matchesType(value, schemaType any) bool {
	if values, ok := schemaType.([]any); ok {
		for _, item := range values {
			if matchesType(value, item) {
				return true
			}
		}
		return false
	}
	typeName, ok := schemaType.(string)
	if !ok {
		return false
	}
	switch typeName {
	case "object":
		_, ok := value.(map[string]any)
		return ok
	case "array":
		_, ok := value.([]any)
		return ok
	case "string":
		_, ok := value.(string)
		return ok
	case "number":
		_, ok := value.(float64)
		return ok
	case "integer":
		number, ok := value.(float64)
		return ok && number == float64(int64(number))
	case "boolean":
		_, ok := value.(bool)
		return ok
	case "null":
		return value == nil
	default:
		return false
	}
}

func integerConstraint(schema map[string]any, key string) (int, bool) {
	value, ok := schema[key].(float64)
	if !ok || value != float64(int(value)) || value < 0 {
		return 0, false
	}
	return int(value), true
}

func numberConstraint(schema map[string]any, key string) (float64, bool) {
	value, ok := schema[key].(float64)
	return value, ok
}
