package wails

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	workspaceapp "github.com/Liapoldus/studio/internal/application/workspace"
	"github.com/Liapoldus/studio/internal/domain/interfaces"
	"github.com/Liapoldus/studio/internal/domain/models"
)

const adminServiceDescriptorFixture = `{"service":"server","version":1,"pages":[{"id":"sites","sections":[{"id":"sites","kind":"table","queryResource":"sites","columns":["siteId","currentRevision"],"actions":[{"id":"rollback","title":"Откатить релиз","confirmation":"Переключить текущий релиз на предыдущий?","dangerous":true,"ifMatchField":"expectedCurrentRevision"}]}]}]}`

func adminSurfaceFixture() []byte {
	digest := sha256.Sum256([]byte(adminServiceDescriptorFixture))
	return []byte(fmt.Sprintf(`{"serviceId":"server","digest":"sha256:%s","descriptor":%s}`, hex.EncodeToString(digest[:]), adminServiceDescriptorFixture))
}

type adminSurfaceCLIRunner struct {
	interfaces.CLIRunner
	calls   []models.CLIRequest
	root    string
	inspect func(models.CLIRequest) error
	query   []byte
	invoke  []byte
}

func (runner *adminSurfaceCLIRunner) Run(_ context.Context, request models.CLIRequest) (<-chan models.CLIEvent, error) {
	runner.calls = append(runner.calls, request)
	var payload []byte
	switch {
	case len(request.Args) >= 3 && request.Args[0] == "service" && request.Args[1] == "admin-surface" && request.Args[2] == "inspect":
		payload = adminSurfaceFixture()
		if runner.inspect != nil {
			if err := runner.inspect(request); err != nil {
				return nil, err
			}
		}
	case len(request.Args) >= 3 && request.Args[0] == "service" && request.Args[1] == "admin" && request.Args[2] == "query":
		payload = runner.query
	case len(request.Args) >= 3 && request.Args[0] == "service" && request.Args[1] == "admin" && request.Args[2] == "invoke":
		payload = runner.invoke
		for index, argument := range request.Args {
			if argument == "--request-file" && index+1 < len(request.Args) {
				path := request.Args[index+1]
				if !filepath.IsAbs(path) {
					path = filepath.Join(runner.root, filepath.FromSlash(path))
				}
				relative, err := filepath.Rel(runner.root, path)
				if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
					return nil, fmt.Errorf("staged action input escaped the project")
				}
				contents, err := fs.ReadFile(os.DirFS(runner.root), filepath.ToSlash(relative))
				if err != nil {
					return nil, err
				}
				if !reflect.DeepEqual(contents, []byte(`{"siteId":"docs","expectedCurrentRevision":"r-2","targetRevision":"r-1"}`)) {
					return nil, fmt.Errorf("unexpected staged action input: %s", contents)
				}
				info, err := os.Stat(path)
				if err != nil || info.Mode().Perm() != 0o600 {
					return nil, fmt.Errorf("staged action input does not have private permissions")
				}
			}
		}
	default:
		return nil, fmt.Errorf("unexpected CLI request: %#v", request.Args)
	}
	return closedCLIEvents(models.CLIEvent{SchemaVersion: "cli-events/v1", Type: "run.output", Payload: payload}, models.CLIEvent{SchemaVersion: "cli-events/v1", Type: "run.completed"}), nil
}

func adminActionApp(t *testing.T, runner *adminSurfaceCLIRunner) (*App, models.Project) {
	t.Helper()
	root := t.TempDir()
	runner.root = root
	project := models.Project{ID: "admin-project", Name: "Admin project", RootPath: root}
	workspace := models.Workspace{Project: &project, Graph: models.ServiceGraph{Services: []models.RuntimeService{{ID: "server"}}}}
	store := metadataProjectStore{projects: []models.Project{project}}
	app := NewApp(nil, workspaceapp.New(store, metadataProjectSource{workspace: workspace}), nil, nil, nil, runner, nil, nil, nil, nil, nil, nil, nil)
	return app, project
}

func TestReadRuntimeServiceAdminTableUsesTypedCLIAndFiltersColumns(t *testing.T) {
	runner := &adminSurfaceCLIRunner{query: []byte(`{"serviceId":"server","pageId":"sites","sectionId":"sites","data":{"items":[{"siteId":"docs","currentRevision":"r-2","privateKey":"must-not-leak"}],"nextCursor":"cursor-2"}}`)}
	app, project := adminActionApp(t, runner)
	digest := sha256.Sum256([]byte(adminServiceDescriptorFixture))
	surfaceDigest := "sha256:" + hex.EncodeToString(digest[:])
	body, err := app.ReadRuntimeServiceAdminTable(project.ID, "server", "sites", "sites", surfaceDigest, "cursor-1")
	if err != nil || strings.Contains(body, "privateKey") || strings.Contains(body, "must-not-leak") || !strings.Contains(body, `"currentRevision":"r-2"`) {
		t.Fatalf("table body=%s err=%v", body, err)
	}
	want := [][]string{
		{"service", "admin-surface", "inspect", "server", "--target", "local"},
		{"service", "admin", "query", "server", "--page", "sites", "--section", "sites", "--surface-digest", surfaceDigest, "--cursor", "cursor-1", "--target", "local"},
	}
	if len(runner.calls) != len(want) {
		t.Fatalf("CLI calls=%d want=%d", len(runner.calls), len(want))
	}
	for index := range want {
		if !reflect.DeepEqual(runner.calls[index].Args, want[index]) || runner.calls[index].ProjectRoot != project.RootPath {
			t.Fatalf("CLI call %d=%+v want args=%q", index, runner.calls[index], want[index])
		}
	}
}

func TestReadRuntimeServiceAdminTableRejectsStaleDescriptorBeforeQuery(t *testing.T) {
	runner := &adminSurfaceCLIRunner{query: []byte(`{"serviceId":"server","pageId":"sites","sectionId":"sites","data":{"items":[],"nextCursor":null}}`)}
	app, project := adminActionApp(t, runner)
	_, err := app.ReadRuntimeServiceAdminTable(project.ID, "server", "sites", "sites", "sha256:"+strings.Repeat("0", 64), "")
	if err == nil || err.Error() != "bridge.admin_surface_changed" || len(runner.calls) != 1 {
		t.Fatalf("stale query should stop after descriptor read: calls=%d err=%v", len(runner.calls), err)
	}
}

func TestInvokeRuntimeServiceAdminActionConfirmsStagesAndCleansProjectInput(t *testing.T) {
	runner := &adminSurfaceCLIRunner{invoke: []byte(`{"completed":true}`)}
	runner.inspect = func(request models.CLIRequest) error {
		if len(request.Args) >= 3 && request.Args[1] == "admin" && request.Args[2] == "invoke" {
			return fmt.Errorf("action dispatched before surface inspection")
		}
		return nil
	}
	app, project := adminActionApp(t, runner)
	confirmed := false
	digest := sha256.Sum256([]byte(adminServiceDescriptorFixture))
	liveDigest := "sha256:" + hex.EncodeToString(digest[:])
	result, err := app.invokeRuntimeServiceAdminAction(project.ID, "server", "sites", "sites", "rollback",
		`{"siteId":"docs","expectedCurrentRevision":"r-2","targetRevision":"r-1"}`, "", liveDigest,
		func(_ context.Context, title, message string) (bool, error) {
			confirmed = title == "Подтвердите действие сервиса" && strings.Contains(message, "Переключить текущий релиз") && strings.Contains(message, project.Name)
			return confirmed, nil
		})
	if err != nil || !confirmed || result != `{"completed":true}` || len(runner.calls) != 2 {
		t.Fatalf("result=%s confirmed=%t calls=%d err=%v", result, confirmed, len(runner.calls), err)
	}
	invoke := runner.calls[1]
	if !reflect.DeepEqual(invoke.Args[:9], []string{"service", "admin", "invoke", "server", "--page", "sites", "--section", "sites", "--action"}) || invoke.Args[9] != "rollback" {
		t.Fatalf("unexpected typed action command: %#v", invoke.Args)
	}
	if len(invoke.Args) < 14 || invoke.Args[10] != "--project" || invoke.Args[12] != "--surface-digest" || invoke.Args[13] != liveDigest {
		t.Fatalf("action command did not bind the live descriptor digest: %#v", invoke.Args)
	}
	if strings.Contains(strings.Join(invoke.Args, " "), "targetRevision") || strings.Contains(strings.Join(invoke.Args, " "), "docs") {
		t.Fatalf("action values leaked into CLI arguments: %#v", invoke.Args)
	}
	requestIndex := -1
	for index, argument := range invoke.Args {
		if argument == "--request-file" && index+1 < len(invoke.Args) {
			requestIndex = index + 1
		}
	}
	requestPath := ""
	if requestIndex >= 0 {
		requestPath = invoke.Args[requestIndex]
	}
	relativePath, relErr := filepath.Rel(project.RootPath, requestPath)
	if requestIndex < 0 || relErr != nil || !strings.HasPrefix(filepath.ToSlash(relativePath), ".studio/resource-action-") {
		t.Fatalf("input was not staged privately: %#v", invoke.Args)
	}
	if _, err := os.Stat(requestPath); !os.IsNotExist(err) {
		t.Fatalf("staged action file was not cleaned: %v", err)
	}
}

func TestInvokeRuntimeServiceAdminActionRejectsStaleDigestAndDeniedConfirmation(t *testing.T) {
	digest := sha256.Sum256([]byte(adminServiceDescriptorFixture))
	validDigest := "sha256:" + hex.EncodeToString(digest[:])
	for _, test := range []struct {
		name      string
		digest    string
		confirmed bool
	}{
		{name: "stale descriptor", digest: "sha256:" + strings.Repeat("a", 64), confirmed: true},
		{name: "confirmation denied", digest: validDigest, confirmed: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			runner := &adminSurfaceCLIRunner{invoke: []byte(`{"completed":true}`)}
			app, project := adminActionApp(t, runner)
			_, err := app.invokeRuntimeServiceAdminAction(project.ID, "server", "sites", "sites", "rollback",
				`{"siteId":"docs","expectedCurrentRevision":"r-2","targetRevision":"r-1"}`, "r-2", test.digest,
				func(context.Context, string, string) (bool, error) { return test.confirmed, nil })
			if err == nil || len(runner.calls) != 1 {
				t.Fatalf("action should not execute: calls=%d err=%v", len(runner.calls), err)
			}
		})
	}
}

var _ interfaces.CLIRunner = (*adminSurfaceCLIRunner)(nil)
