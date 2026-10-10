// Package workspace implements project opening and desktop workspace state.
package workspace

import (
	"context"

	"github.com/Liapoldus/studio/internal/domain/interfaces"
	"github.com/Liapoldus/studio/internal/domain/models"
)

type Service struct {
	projects interfaces.DesktopStore
	source   interfaces.ProjectSource
}

func New(projects interfaces.DesktopStore, source interfaces.ProjectSource) *Service {
	return &Service{projects: projects, source: source}
}

func (s *Service) ListProjects(ctx context.Context) ([]models.Project, error) {
	return s.projects.ListProjects(ctx)
}

func (s *Service) Open(ctx context.Context, root string) (models.Workspace, error) {
	workspace, err := s.source.Open(ctx, root)
	if err != nil {
		return models.Workspace{}, err
	}
	if workspace.Project == nil {
		return models.Workspace{}, models.ErrInvalidProject
	}
	if err := s.projects.SaveProject(ctx, *workspace.Project); err != nil {
		return models.Workspace{}, err
	}
	if err := s.projects.SaveClientState(ctx, models.ClientState{SelectedProjectID: workspace.Project.ID}); err != nil {
		return models.Workspace{}, err
	}
	return workspace, nil
}

func (s *Service) Current(ctx context.Context) (models.Workspace, error) {
	state, err := s.projects.ReadClientState(ctx)
	if err != nil {
		return models.Workspace{}, err
	}
	if state.SelectedProjectID == "" {
		return models.Workspace{
			Files: []models.ProjectFile{},
			Graph: models.PluginGraph{Plugins: []models.RuntimePlugin{}, Links: []models.PluginLink{}},
		}, nil
	}
	projects, err := s.projects.ListProjects(ctx)
	if err != nil {
		return models.Workspace{}, err
	}
	for _, project := range projects {
		if project.ID == state.SelectedProjectID {
			return s.source.Open(ctx, project.RootPath)
		}
	}
	return models.Workspace{
		Files: []models.ProjectFile{},
		Graph: models.PluginGraph{Plugins: []models.RuntimePlugin{}, Links: []models.PluginLink{}},
	}, nil
}
