// Package wails exposes Studio use cases to the desktop frontend.
package wails

import (
	"context"

	"github.com/Liapoldus/studio/internal/application/product"
	"github.com/Liapoldus/studio/internal/domain/models"
)

type App struct {
	ctx         context.Context
	productInfo *product.ProductInfo
}

func NewApp(productInfo *product.ProductInfo) *App {
	return &App{productInfo: productInfo}
}

func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) ProductInfo() (models.ProductInfo, error) {
	return a.productInfo.Execute(a.ctx)
}
