package main

import (
	"errors"
	"log"
	"os"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"

	"github.com/Liapoldus/studio/internal/application/product"
	"github.com/Liapoldus/studio/internal/infrastructure/assets/desktop"
	"github.com/Liapoldus/studio/internal/infrastructure/config"
	productdata "github.com/Liapoldus/studio/internal/infrastructure/product"
	"github.com/Liapoldus/studio/internal/infrastructure/sqlite"
	wailspresentation "github.com/Liapoldus/studio/internal/presentation/wails"
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() (runErr error) {
	if len(os.Args) != 1 {
		log.Fatal("Studio desktop accepts ENV bootstrap only; command-line arguments are unsupported")
	}
	bootstrap, err := config.DesktopFromENV()
	if err != nil {
		return err
	}
	store, err := sqlite.Open(bootstrap.DatabasePath)
	if err != nil {
		return err
	}
	defer func() { runErr = errors.Join(runErr, store.Close()) }()
	productInfo := productdata.NewStaticReader(
		"project",
		"file-tree",
		"git",
		"cli-reports",
	)
	app := wailspresentation.NewApp(product.NewProductInfo(productInfo))

	err = wails.Run(&options.App{
		Title:  "Liapoldus Studio",
		Width:  1024,
		Height: 768,
		AssetServer: &assetserver.Options{
			Assets: desktop.Files,
		},
		BackgroundColour: &options.RGBA{R: 18, G: 24, B: 33, A: 1},
		OnStartup:        app.Startup,
		Bind: []interface{}{
			app,
		},
	})

	return err
}
