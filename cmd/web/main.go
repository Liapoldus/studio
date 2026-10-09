package main

import (
	"io/fs"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/Liapoldus/studio/internal/application/product"
	"github.com/Liapoldus/studio/internal/domain/models"
	"github.com/Liapoldus/studio/internal/infrastructure/assets/web"
	"github.com/Liapoldus/studio/internal/infrastructure/config"
	productdata "github.com/Liapoldus/studio/internal/infrastructure/product"
	webpresentation "github.com/Liapoldus/studio/internal/presentation/web"
)

func main() {
	if len(os.Args) != 1 {
		log.Fatal("Studio web accepts ENV bootstrap only; command-line arguments are unsupported")
	}
	webConfig, err := config.LoadWeb(os.LookupEnv)
	if err != nil {
		log.Fatal(err)
	}

	assets, err := fs.Sub(web.Files, "dist")
	if err != nil {
		log.Fatal(err)
	}

	productInfo := product.NewProductInfo(productdata.NewStaticReader(
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
