package models

import (
	"errors"
	"path/filepath"
	"strings"
)

var ErrInvalidProject = errors.New("invalid Studio project")

// Project is Studio-owned metadata for a local project workspace. It never
// contains Core settings, credentials or runtime observations.
type Project struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	RootPath string `json:"rootPath"`
}

func NewProject(id, name, rootPath string) (Project, error) {
	id = strings.TrimSpace(id)
	name = strings.TrimSpace(name)
	rootPath = filepath.Clean(strings.TrimSpace(rootPath))
	if id == "" || name == "" || rootPath == "." || !filepath.IsAbs(rootPath) || strings.ContainsRune(rootPath, '\x00') {
		return Project{}, ErrInvalidProject
	}
	return Project{ID: id, Name: name, RootPath: rootPath}, nil
}
