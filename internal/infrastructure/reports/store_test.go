package reports

import (
	"context"
	"io/fs"
	"os"
	"strings"
	"testing"

	"github.com/Liapoldus/studio/internal/domain/models"
)

func TestStoreRedactsBeforePersistence(t *testing.T) {
	root := t.TempDir()
	path, err := (Store{}).Save(context.Background(), root, models.Report{
		ProjectID:   "demo",
		OperationID: "op-1",
		Traffic: []models.TrafficRecord{{
			RequestPayload:  []byte(`{"message":"hello","token":"secret-value"}`),
			ResponsePayload: []byte(`{"result":"ok"}`),
		}},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	relative := strings.TrimPrefix(path, ".studio/")
	data, err := fs.ReadFile(os.DirFS(root+"/.studio"), relative)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "secret-value") || !strings.Contains(string(data), "[REDACTED]") {
		t.Fatalf("unsafe report: %s", data)
	}
	values, err := (Store{}).List(context.Background(), root)
	if err != nil || len(values) != 1 {
		t.Fatalf("reports=%+v err=%v", values, err)
	}
}
