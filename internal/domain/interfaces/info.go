package interfaces

import (
	"context"

	"github.com/Liapoldus/studio/internal/domain/models"
)

type ProductInfoReader interface {
	Read(context.Context) (models.ProductInfo, error)
}
