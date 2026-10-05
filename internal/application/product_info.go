package application

import (
	"context"

	"github.com/Liapoldus/studio/internal/domain/interfaces"
	"github.com/Liapoldus/studio/internal/domain/models"
)

type ProductInfo struct {
	reader interfaces.ProductInfoReader
}

func NewProductInfo(reader interfaces.ProductInfoReader) *ProductInfo {
	return &ProductInfo{reader: reader}
}

func (u *ProductInfo) Execute(ctx context.Context) (models.ProductInfo, error) {
	return u.reader.Read(ctx)
}
