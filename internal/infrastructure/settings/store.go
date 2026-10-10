// Package settings implements the schema-aware project settings boundary.
package settings

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strconv"
	"strings"

	"github.com/Liapoldus/studio/internal/domain/interfaces"
)

var (
	ErrInvalidSchema    = errors.New("invalid settings schema")
	ErrSensitiveField   = errors.New("sensitive settings fields are managed outside Studio")
	ErrUnsupportedPatch = errors.New("settings patch is not allowed by schema")
)

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

func (s Store) Read(ctx context.Context, root, settingsPath, schemaPath string) ([]byte, error) {
	if s.Files == nil {
		return nil, ErrInvalidSchema
	}
	schema, err := s.readSchema(ctx, root, schemaPath)
	if err != nil {
		return nil, err
	}
	settings, err := s.readJSON(ctx, root, settingsPath, false)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if settings == nil {
		settings = map[string]any{}
	}
	safe := redactValue(settings, schema)
	return json.MarshalIndent(safe, "", "  ")
}

func (s Store) Update(ctx context.Context, root, settingsPath, schemaPath string, patch []byte) error {
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
	var value any
	if unmarshalErr := json.Unmarshal(patch, &value); unmarshalErr != nil {
		return fmt.Errorf("decode settings patch: %w", unmarshalErr)
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
	return s.Files.WriteFile(ctx, root, settingsPath, data)
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
	normalized, err := normalizeSchemaPath(schemaPath)
	if err != nil {
		return nil, err
	}
	value, err := s.readJSON(ctx, root, normalized, true)
	if err != nil {
		return nil, err
	}
	resolver := schemaResolver{
		readFile: func(path string) ([]byte, error) {
			return s.Files.ReadFile(ctx, root, path)
		},
		docs:  map[string]any{normalized: value},
		stack: map[string]bool{},
	}
	return resolver.resolve(value, normalized, value)
}

type schemaResolver struct {
	readFile func(string) ([]byte, error)
	docs     map[string]any
	stack    map[string]bool
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
			for key, child := range typed {
				if key == "$ref" {
					continue
				}
				resolved, err := resolver.resolve(child, documentPath, documentRoot)
				if err != nil {
					return nil, err
				}
				result[key] = resolved
			}
			return result, nil
		}
		result := make(map[string]any, len(typed))
		for key, child := range typed {
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
		if filepath.IsAbs(pathPart) {
			return nil, "", nil, "", fmt.Errorf("%w: absolute schema reference %s", ErrInvalidSchema, ref)
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
			if _, ok := loaded.(map[string]any); !ok {
				return nil, "", nil, "", fmt.Errorf("%w: schema reference %s is not an object", ErrInvalidSchema, ref)
			}
			resolver.docs[targetPath] = loaded
		}
		targetRoot = loaded
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

func redactValue(value any, schema any) any {
	if isSensitive(schema, "") {
		return nil
	}
	schemaObject, schemaOK := schema.(map[string]any)
	object, objectOK := value.(map[string]any)
	if schemaOK && objectOK {
		properties, propertiesOK := schemaObject["properties"].(map[string]any)
		if !propertiesOK {
			properties = map[string]any{}
		}
		result := make(map[string]any, len(object))
		for key, child := range object {
			result[key] = redactValue(child, properties[key])
		}
		return result
	}
	if values, ok := value.([]any); ok && schemaOK {
		items := schemaObject["items"]
		result := make([]any, len(values))
		for index, child := range values {
			result[index] = redactValue(child, items)
		}
		return result
	}
	return value
}

func mergeSafe(current, patch, schema any) (any, error) {
	if isSensitive(schema, "") {
		return nil, ErrSensitiveField
	}
	patchObject, patchOK := patch.(map[string]any)
	if !patchOK {
		return nil, ErrUnsupportedPatch
	}
	currentObject, currentOK := current.(map[string]any)
	if !currentOK {
		currentObject = map[string]any{}
	}
	schemaObject, schemaOK := schema.(map[string]any)
	if !schemaOK {
		return nil, ErrInvalidSchema
	}
	properties, propertiesOK := schemaObject["properties"].(map[string]any)
	if !propertiesOK {
		properties = map[string]any{}
	}
	for key, child := range patchObject {
		childSchema, declared := properties[key]
		if !declared {
			return nil, fmt.Errorf("%w: %s", ErrUnsupportedPatch, key)
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
		if containsSensitiveItems(childSchema) {
			return nil, fmt.Errorf("%w: %s", ErrSensitiveField, key)
		}
		currentObject[key] = child
	}
	return currentObject, nil
}

func containsSensitiveItems(schema any) bool {
	object, ok := schema.(map[string]any)
	if !ok {
		return false
	}
	if isSensitive(object, "") {
		return true
	}
	items, ok := object["items"]
	if !ok {
		return false
	}
	return isSensitive(items, "") || containsSensitiveItems(items)
}

func isSensitive(schema any, propertyName string) bool {
	object, ok := schema.(map[string]any)
	if ok {
		for _, key := range []string{"x-sensitive", "x-secret", "x-redacted"} {
			if sensitive, exists := object[key].(bool); exists && sensitive {
				return true
			}
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
		for name, child := range typed {
			childSchema, declared := properties[name]
			if !declared {
				additional, hasAdditional := object["additionalProperties"]
				if hasAdditional {
					allowed, ok := additional.(bool)
					if !ok || !allowed {
						return fmt.Errorf("%w: %s.%s is not declared", ErrUnsupportedPatch, path, name)
					}
				}
				continue
			}
			if err := validateValue(child, childSchema, path+"."+name); err != nil {
				return err
			}
		}
	case []any:
		if limit, exists := integerConstraint(object, "minItems"); exists && len(typed) < limit {
			return fmt.Errorf("%w: %s has too few items", ErrUnsupportedPatch, path)
		}
		if limit, exists := integerConstraint(object, "maxItems"); exists && len(typed) > limit {
			return fmt.Errorf("%w: %s has too many items", ErrUnsupportedPatch, path)
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
		if maximum, exists := numberConstraint(object, "maximum"); exists && typed > maximum {
			return fmt.Errorf("%w: %s is above maximum", ErrUnsupportedPatch, path)
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
