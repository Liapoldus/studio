// Package reports persists only redacted CLI/Core evidence in project-local state.
package reports

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/Liapoldus/studio/internal/domain/interfaces"
	"github.com/Liapoldus/studio/internal/domain/models"
)

var ErrInvalidReport = errors.New("invalid report")

type Store struct{}

var _ interfaces.ReportStore = Store{}

func (Store) Save(ctx context.Context, root string, report models.Report, annotations []models.RedactionAnnotation) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if !filepath.IsAbs(root) || strings.ContainsRune(root, '\x00') || strings.TrimSpace(report.ProjectID) == "" {
		return "", ErrInvalidReport
	}
	for index := range report.Traffic {
		request, err := models.RedactJSON(report.Traffic[index].RequestPayload, annotations)
		if err != nil {
			return "", ErrInvalidReport
		}
		response, err := models.RedactJSON(report.Traffic[index].ResponsePayload, annotations)
		if err != nil {
			return "", ErrInvalidReport
		}
		report.Traffic[index].RequestPayload = request
		report.Traffic[index].ResponsePayload = response
	}
	if report.SchemaVersion == "" {
		report.SchemaVersion = "studio-reports/v1"
	}
	data, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return "", ErrInvalidReport
	}
	directory := filepath.Join(filepath.Clean(root), ".studio", "reports")
	if mkdirErr := os.MkdirAll(directory, 0700); mkdirErr != nil {
		return "", mkdirErr
	}
	name := safeName(report.OperationID)
	if name == "" {
		name = safeName(report.CommitSHA)
	}
	if name == "" {
		name = "report"
	}
	path := filepath.Join(directory, name+".json")
	temporary, err := os.CreateTemp(directory, ".report-*")
	if err != nil {
		return "", err
	}
	temporaryPath := temporary.Name()
	defer func() { discardError(os.Remove(temporaryPath)) }()
	if err := temporary.Chmod(0600); err != nil {
		discardError(temporary.Close())
		return "", err
	}
	if _, err := temporary.Write(data); err != nil {
		discardError(temporary.Close())
		return "", err
	}
	if err := temporary.Close(); err != nil {
		return "", err
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return "", err
	}
	return filepath.ToSlash(filepath.Join(".studio", "reports", filepath.Base(path))), nil
}

func (Store) List(ctx context.Context, root string) ([]models.Report, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	directory := filepath.Join(filepath.Clean(root), ".studio", "reports")
	entries, err := os.ReadDir(directory)
	if errors.Is(err, os.ErrNotExist) {
		return []models.Report{}, nil
	}
	if err != nil {
		return nil, err
	}
	paths := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".json") {
			paths = append(paths, filepath.Join(directory, entry.Name()))
		}
	}
	sort.Strings(paths)
	values := make([]models.Report, 0, len(paths))
	for _, path := range paths {
		data, readErr := fs.ReadFile(os.DirFS(directory), filepath.Base(path))
		if readErr != nil {
			return nil, readErr
		}
		var report models.Report
		if unmarshalErr := json.Unmarshal(data, &report); unmarshalErr != nil {
			return nil, ErrInvalidReport
		}
		values = append(values, report)
	}
	return values, nil
}

func safeName(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	var builder strings.Builder
	for _, character := range value {
		if character >= 'a' && character <= 'z' || character >= 'A' && character <= 'Z' || character >= '0' && character <= '9' || character == '-' || character == '_' {
			if _, err := builder.WriteRune(character); err != nil {
				return ""
			}
		}
	}
	return builder.String()
}

func discardError(err error) { _ = err }
