// Package project reads the canonical CLI project tree for the desktop shell.
package project

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/Liapoldus/studio/internal/domain/interfaces"
	"github.com/Liapoldus/studio/internal/domain/models"
)

var ErrProjectManifest = errors.New("project.yaml is required")

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
	git := models.GitStatus{}
	if sourceGit := s.Git; sourceGit != nil {
		git, err = sourceGit.Status(ctx, root)
		if err != nil {
			// A project remains useful offline when Git is missing or the folder
			// has not been initialized yet. The UI will render an empty Git state.
			git = models.GitStatus{}
		}
	}
	return models.Workspace{
		Project: &value,
		Files:   files,
		Git:     git,
		Graph:   pluginGraph,
	}, nil
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
