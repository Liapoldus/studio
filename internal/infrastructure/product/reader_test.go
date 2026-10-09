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
		name   string
		modes  []models.CoreAccessMode
		want   []string
		single bool
	}{
		{"desktop", []models.CoreAccessMode{models.CoreAccessDirect, models.CoreAccessSSHBridge}, []string{"direct", "ssh-bridge"}, false},
		{"web", []models.CoreAccessMode{models.CoreAccessDirect}, []string{"direct"}, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			reader := NewStaticReader(test.single, test.modes...)
			test.modes[0] = models.CoreAccessSSHBridge
			want := models.ProductInfo{
				Name: "Liapoldus Studio", Description: "Клиент для обслуживания экосистемы Liapoldus.",
				CoreAccessModes: test.want, SingleCoreBinding: test.single,
			}
			value, err := reader.Read(context.Background())
			if err != nil || !reflect.DeepEqual(value, want) {
				t.Fatalf("product information: %+v, %v; want %+v", value, err, want)
			}
			value.CoreAccessModes[0] = "changed"
			value, err = reader.Read(context.Background())
			if err != nil || !reflect.DeepEqual(value, want) {
				t.Fatalf("caller mutated code-owned information: %+v, %v", value, err)
			}
		})
	}
}

func TestProductInfoRequiresModes(t *testing.T) {
	if _, err := NewStaticReader(false).Read(context.Background()); !errors.Is(err, models.ErrInvalidProductInfo) {
		t.Fatalf("missing modes: %v", err)
	}
}
