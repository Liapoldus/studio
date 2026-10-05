package productinfo

import (
	"context"

	"github.com/Liapoldus/studio/internal/domain/models"
)

type StaticReader struct {
	accessModes       []models.CoreAccessMode
	singleCoreBinding bool
}

func NewStaticReader(singleCoreBinding bool, accessModes ...models.CoreAccessMode) StaticReader {
	return StaticReader{accessModes: append([]models.CoreAccessMode(nil), accessModes...), singleCoreBinding: singleCoreBinding}
}

func (r StaticReader) Read(context.Context) (models.ProductInfo, error) {
	return models.NewProductInfo(
		"Liapoldus Studio",
		"Клиент для обслуживания экосистемы Liapoldus.",
		modeNames(r.accessModes),
		r.singleCoreBinding,
	)
}

func modeNames(modes []models.CoreAccessMode) []string {
	result := make([]string, 0, len(modes))
	for _, mode := range modes {
		result = append(result, string(mode))
	}
	return result
}
