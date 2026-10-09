// Package product describes the capabilities of the Studio shell.
package product

import (
	"context"

	"github.com/Liapoldus/studio/internal/domain/models"
)

type StaticReader struct {
	features []string
}

func NewStaticReader(features ...string) StaticReader {
	return StaticReader{features: append([]string(nil), features...)}
}

func (r StaticReader) Read(context.Context) (models.ProductInfo, error) {
	return models.NewProductInfo(
		"Liapoldus Studio",
		"Среда разработки проектов, конфигураций и Git-версий Liapoldus.",
		r.features,
	)
}
