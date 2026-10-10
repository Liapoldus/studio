// Package diagnostics persists safe, recoverable desktop diagnostics.
package diagnostics

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Liapoldus/studio/internal/domain/interfaces"
	"github.com/Liapoldus/studio/internal/domain/models"
)

var ErrInvalidDiagnostic = errors.New("invalid Studio diagnostic")

type Store struct{}

var _ interfaces.DiagnosticStore = Store{}

func (Store) Append(ctx context.Context, root string, diagnostic models.Diagnostic) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !filepath.IsAbs(root) || strings.ContainsRune(root, '\x00') || strings.TrimSpace(diagnostic.Code) == "" || strings.TrimSpace(diagnostic.Owner) == "" {
		return ErrInvalidDiagnostic
	}
	diagnostic.SchemaVersion = "studio-diagnostics/v1"
	if diagnostic.Timestamp == "" {
		diagnostic.Timestamp = time.Now().UTC().Format(time.RFC3339Nano)
	}
	diagnostic.Message = models.RedactText(strings.TrimSpace(diagnostic.Message))
	if len(diagnostic.Message) > 4096 {
		diagnostic.Message = diagnostic.Message[:4096]
	}
	data, err := json.Marshal(diagnostic)
	if err != nil {
		return ErrInvalidDiagnostic
	}
	directory := filepath.Join(filepath.Clean(root), ".studio")
	if mkdirErr := os.MkdirAll(directory, 0700); mkdirErr != nil {
		return mkdirErr
	}
	file, err := os.OpenFile(filepath.Join(directory, "diagnostics.jsonl"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600) //nolint:gosec // project root is validated and diagnostics are project-local.
	if err != nil {
		return err
	}
	defer func() { discardError(file.Close()) }()
	_, err = file.Write(append(data, '\n'))
	return err
}

func (Store) List(ctx context.Context, root string) ([]models.Diagnostic, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if !filepath.IsAbs(root) || strings.ContainsRune(root, '\x00') {
		return nil, ErrInvalidDiagnostic
	}
	path := filepath.Join(filepath.Clean(root), ".studio", "diagnostics.jsonl")
	file, err := os.Open(path) //nolint:gosec // project root is validated and diagnostics are project-local.
	if errors.Is(err, os.ErrNotExist) {
		return []models.Diagnostic{}, nil
	}
	if err != nil {
		return nil, err
	}
	defer func() { discardError(file.Close()) }()
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 4096), 64*1024)
	result := make([]models.Diagnostic, 0)
	for scanner.Scan() {
		var diagnostic models.Diagnostic
		if err := json.Unmarshal(scanner.Bytes(), &diagnostic); err != nil || diagnostic.SchemaVersion != "studio-diagnostics/v1" {
			continue
		}
		result = append(result, diagnostic)
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	if len(result) > 100 {
		result = result[len(result)-100:]
	}
	return result, nil
}

func discardError(err error) { _ = err }
