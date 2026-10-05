package wails

import (
	"context"

	"github.com/Liapoldus/studio/internal/application"
	"github.com/Liapoldus/studio/internal/domain/models"
)

type App struct {
	ctx         context.Context
	productInfo *application.ProductInfo
}

func NewApp(productInfo *application.ProductInfo) *App {
	return &App{productInfo: productInfo}
}

func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) ProductInfo() (models.ProductInfo, error) {
	return a.productInfo.Execute(a.ctx)
}
