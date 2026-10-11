// Package project reads the canonical CLI project tree for the desktop shell.
package project

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/Liapoldus/studio/internal/domain/interfaces"
	"github.com/Liapoldus/studio/internal/domain/models"
)

var ErrProjectManifest = errors.New("project.yaml is required")
var ErrProjectDirectoryExists = errors.New("project directory already exists")
var ErrInvalidProjectIdentity = errors.New("project id and name contain unsupported characters")

type Source struct {
	Git interfaces.GitRepository
}

func (s Source) Open(ctx context.Context, root string) (models.Workspace, error) {
	if err := ctx.Err(); err != nil {
		return models.Workspace{}, err
	}
	root = filepath.Clean(strings.TrimSpace(root))
	if !filepath.IsAbs(root) || strings.ContainsRune(root, '\x00') {
		return models.Workspace{}, models.ErrInvalidProject
	}
	manifestData, err := fs.ReadFile(os.DirFS(root), "project.yaml")
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return models.Workspace{}, ErrProjectManifest
		}
		return models.Workspace{}, err
	}
	id, name := filepath.Base(root), filepath.Base(root)
	for _, lineValue := range strings.Split(string(manifestData), "\n") {
		line := strings.TrimSpace(lineValue)
		if value, ok := manifestValue(line, "id"); ok {
			id = value
		}
		if value, ok := manifestValue(line, "name"); ok {
			name = value
		}
	}
	value, err := models.NewProject(id, name, root)
	if err != nil {
		return models.Workspace{}, err
	}
	files, err := tree(ctx, root)
	if err != nil {
		return models.Workspace{}, err
	}
	pluginGraph, err := graph(root)
	if err != nil {
		return models.Workspace{}, err
	}
	git := models.GitStatus{Changes: []models.GitChange{}}
	if sourceGit := s.Git; sourceGit != nil {
		git, err = sourceGit.Status(ctx, root)
		if err != nil {
			// A project remains useful offline when Git is missing or the folder
			// has not been initialized yet. The UI will render an empty Git state.
			git = models.GitStatus{Changes: []models.GitChange{}}
		}
	}
	return models.Workspace{
		Project: &value,
		Files:   files,
		Git:     git,
		Graph:   pluginGraph,
	}, nil
}

func (s Source) Create(ctx context.Context, root, id, name string) (models.Workspace, error) {
	if err := ctx.Err(); err != nil {
		return models.Workspace{}, err
	}
	root = filepath.Clean(strings.TrimSpace(root))
	if !filepath.IsAbs(root) || strings.ContainsRune(root, '\x00') {
		return models.Workspace{}, models.ErrInvalidProject
	}
	if !validProjectID(id) || !validIdentity(name) {
		return models.Workspace{}, ErrInvalidProjectIdentity
	}
	parent := root
	root = filepath.Join(parent, strings.TrimSpace(id))
	if _, err := models.NewProject(id, name, root); err != nil {
		return models.Workspace{}, err
	}
	parentInfo, err := os.Stat(parent)
	if err != nil {
		return models.Workspace{}, err
	}
	if !parentInfo.IsDir() {
		return models.Workspace{}, models.ErrInvalidProject
	}
	if _, statErr := os.Stat(root); statErr == nil {
		return models.Workspace{}, ErrProjectDirectoryExists
	} else if !errors.Is(statErr, os.ErrNotExist) {
		return models.Workspace{}, statErr
	}
	if mkdirErr := os.Mkdir(root, 0750); mkdirErr != nil {
		return models.Workspace{}, mkdirErr
	}
	createdDir := true
	defer func() {
		if createdDir {
			if removeErr := os.Remove(root); removeErr != nil {
				// The directory is still recoverable and must not hide the original error.
				return
			}
		}
	}()
	manifest := "id: " + strconv.Quote(strings.TrimSpace(id)) + "\n" +
		"name: " + strconv.Quote(strings.TrimSpace(name)) + "\n" +
		"version: 1\n"
	file, err := os.OpenFile(filepath.Join(root, "project.yaml"), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600) //nolint:gosec // root is validated and selected by the user.
	if err != nil {
		return models.Workspace{}, err
	}
	if _, writeErr := file.WriteString(manifest); writeErr != nil {
		if closeErr := file.Close(); closeErr != nil {
			return models.Workspace{}, errors.Join(writeErr, closeErr)
		}
		return models.Workspace{}, writeErr
	}
	if closeErr := file.Close(); closeErr != nil {
		return models.Workspace{}, closeErr
	}
	if s.Git != nil {
		if initErr := s.Git.Init(ctx, root); initErr != nil {
			return models.Workspace{}, initErr
		}
	}
	createdDir = false
	return s.Open(ctx, root)
}

func validProjectID(value string) bool {
	value = strings.TrimSpace(value)
	if !validIdentity(value) || value == "." || value == ".." || filepath.VolumeName(value) != "" {
		return false
	}
	return !strings.ContainsAny(value, `/\\`)
}

func validIdentity(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 128 || strings.ContainsAny(value, "\r\n\x00") {
		return false
	}
	return true
}

func manifestValue(line, key string) (string, bool) {
	prefix := key + ":"
	if !strings.HasPrefix(line, prefix) {
		return "", false
	}
	value := strings.TrimSpace(strings.TrimPrefix(line, prefix))
	value = strings.Trim(value, "\"'")
	return value, value != ""
}

func tree(ctx context.Context, root string) ([]models.ProjectFile, error) {
	files := make([]models.ProjectFile, 0)
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if walkErr := ctx.Err(); walkErr != nil {
			return walkErr
		}
		relative, relErr := filepath.Rel(root, path)
		if relErr != nil {
			return relErr
		}
		if relative == "." {
			return nil
		}
		parts := strings.Split(filepath.ToSlash(relative), "/")
		if parts[0] == ".git" || parts[0] == ".studio" {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.IsDir() {
			return nil
		}
		info, infoErr := entry.Info()
		if infoErr != nil {
			return infoErr
		}
		files = append(files, models.ProjectFile{
			Path:  filepath.ToSlash(relative),
			Kind:  fileKind(relative),
			Bytes: info.Size(),
		})
		return nil
	})
	return files, err
}

func fileKind(path string) string {
	extension := strings.ToLower(filepath.Ext(path))
	switch extension {
	case ".yaml", ".yml":
		return "yaml"
	case ".json":
		return "json"
	case ".md":
		return "markdown"
	default:
		return "file"
	}
}
