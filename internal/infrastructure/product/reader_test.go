package product

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/Liapoldus/studio/internal/domain/models"
)

func TestProductInfoParity(t *testing.T) {
	for _, test := range []struct {
		name     string
		features []string
	}{
		{"desktop", []string{"project", "file-tree", "git", "cli-reports"}},
		{"web", []string{"project", "file-tree", "git", "cli-reports"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			reader := NewStaticReader(test.features...)
			want := models.ProductInfo{
				Name: "Liapoldus Studio", Description: "Среда разработки проектов, конфигураций и Git-версий Liapoldus.",
				WorkspaceFeatures: test.features,
			}
			value, err := reader.Read(context.Background())
			if err != nil || !reflect.DeepEqual(value, want) {
				t.Fatalf("product information: %+v, %v; want %+v", value, err, want)
			}
			value.WorkspaceFeatures[0] = "changed"
			value, err = reader.Read(context.Background())
			if err != nil || !reflect.DeepEqual(value, want) {
				t.Fatalf("caller mutated code-owned information: %+v, %v", value, err)
			}
		})
	}
}

func TestProductInfoRequiresFeatures(t *testing.T) {
	if _, err := NewStaticReader().Read(context.Background()); !errors.Is(err, models.ErrInvalidProductInfo) {
		t.Fatalf("missing features: %v", err)
	}
}
