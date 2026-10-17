package workspace

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/Liapoldus/studio/internal/domain/models"
	"github.com/Liapoldus/studio/internal/infrastructure/sqlite"
)

type projectSourceStub struct{}

func (projectSourceStub) Open(_ context.Context, root string) (models.Workspace, error) {
	project, err := models.NewProject(filepath.Base(root), filepath.Base(root), root)
	if err != nil {
		return models.Workspace{}, err
	}
	return models.Workspace{Project: &project}, nil
}

func (source projectSourceStub) Create(ctx context.Context, root, _, _ string) (models.Workspace, error) {
	return source.Open(ctx, root)
}

func TestOpenByIDDoesNotChangeSelectedProject(t *testing.T) {
	ctx := context.Background()
	store, err := sqlite.Open(filepath.Join(t.TempDir(), "studio.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if closeErr := store.Close(); closeErr != nil {
			t.Error(closeErr)
		}
	}()

	for _, id := range []string{"project-a", "project-b"} {
		project, projectErr := models.NewProject(id, id, filepath.Join(t.TempDir(), id))
		if projectErr != nil {
			t.Fatal(projectErr)
		}
		if saveErr := store.SaveProject(ctx, project); saveErr != nil {
			t.Fatal(saveErr)
		}
	}
	if saveErr := store.SaveClientState(ctx, models.ClientState{SelectedProjectID: "project-b"}); saveErr != nil {
		t.Fatal(saveErr)
	}

	service := New(store, projectSourceStub{})
	workspace, err := service.OpenByID(ctx, "project-a")
	if err != nil || workspace.Project == nil || workspace.Project.ID != "project-a" {
		t.Fatalf("opened wrong project: %+v err=%v", workspace.Project, err)
	}
	state, err := store.ReadClientState(ctx)
	if err != nil || state.SelectedProjectID != "project-b" {
		t.Fatalf("background project read changed selection: %+v err=%v", state, err)
	}
}
