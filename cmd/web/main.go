package main

import (
	"flag"
	"io/fs"
	"log"
	"net/http"
	"time"

	"github.com/Liapoldus/studio/internal/application"
	"github.com/Liapoldus/studio/internal/domain/models"
	"github.com/Liapoldus/studio/internal/infrastructure/config"
	"github.com/Liapoldus/studio/internal/infrastructure/productinfo"
	"github.com/Liapoldus/studio/internal/infrastructure/webassets"
	webpresentation "github.com/Liapoldus/studio/internal/presentation/web"
)

func main() {
	configPath := flag.String("config", "configs/studio-web.json", "path to the Studio web configuration")
	flag.Parse()

	webConfig, err := config.LoadWeb(*configPath)
	if err != nil {
		log.Fatal(err)
	}

	assets, err := fs.Sub(webassets.Files, "dist")
	if err != nil {
		log.Fatal(err)
	}

	productInfo := application.NewProductInfo(productinfo.NewStaticReader(
		true,
		models.CoreAccessDirect,
	))
	server := &http.Server{
		Addr:              webConfig.ListenAddress,
		Handler:           webpresentation.NewServer(productInfo, assets),
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Printf("Liapoldus Studio web listening on %s with one fixed Core binding", webConfig.ListenAddress)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
