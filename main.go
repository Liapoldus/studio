package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"

	"github.com/Liapoldus/studio/internal/application"
	"github.com/Liapoldus/studio/internal/domain/models"
	"github.com/Liapoldus/studio/internal/infrastructure/productinfo"
	wailspresentation "github.com/Liapoldus/studio/internal/presentation/wails"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	productInfo := productinfo.NewStaticReader(
		false,
		models.CoreAccessDirect,
		models.CoreAccessSSHBridge,
	)
	app := wailspresentation.NewApp(application.NewProductInfo(productInfo))

	err := wails.Run(&options.App{
		Title:  "Liapoldus Studio",
		Width:  1024,
		Height: 768,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 18, G: 24, B: 33, A: 1},
		OnStartup:        app.Startup,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		log.Fatal(err)
	}
}
