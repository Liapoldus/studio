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

// OpenByID reads a registered Project without changing the active desktop
// selection. Typed background operations use it so a delayed settings save
// cannot be redirected to whichever Project is currently visible.
func (s *Service) OpenByID(ctx context.Context, id string) (models.Workspace, error) {
	if id == "" {
		return models.Workspace{}, models.ErrInvalidProject
	}
	projects, err := s.projects.ListProjects(ctx)
	if err != nil {
		return models.Workspace{}, err
	}
	for _, project := range projects {
		if project.ID != id {
			continue
		}
		workspace, openErr := s.source.Open(ctx, project.RootPath)
		if openErr != nil {
			return models.Workspace{}, openErr
		}
		if workspace.Project == nil || workspace.Project.ID != id {
			return models.Workspace{}, models.ErrInvalidProject
		}
		return workspace, nil
	}
	return models.Workspace{}, models.ErrInvalidProject
}

func (s *Service) Create(ctx context.Context, root, id, name string) (models.Workspace, error) {
	workspace, err := s.source.Create(ctx, root, id, name)
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
			Graph: models.ServiceGraph{Services: []models.RuntimeService{}, Links: []models.ServiceLink{}},
			Git:   models.GitStatus{Changes: []models.GitChange{}},
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
		Graph: models.ServiceGraph{Services: []models.RuntimeService{}, Links: []models.ServiceLink{}},
		Git:   models.GitStatus{Changes: []models.GitChange{}},
	}, nil
}
