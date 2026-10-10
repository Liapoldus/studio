package main

import (
	"errors"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"

	"github.com/Liapoldus/studio/internal/application/product"
	workspaceapp "github.com/Liapoldus/studio/internal/application/workspace"
	desktopassets "github.com/Liapoldus/studio/internal/infrastructure/assets/desktop"
	clirunner "github.com/Liapoldus/studio/internal/infrastructure/cli"
	"github.com/Liapoldus/studio/internal/infrastructure/config"
	desktopintegration "github.com/Liapoldus/studio/internal/infrastructure/desktop"
	diagnosticstore "github.com/Liapoldus/studio/internal/infrastructure/diagnostics"
	projectfiles "github.com/Liapoldus/studio/internal/infrastructure/filesystem"
	gitrepo "github.com/Liapoldus/studio/internal/infrastructure/git"
	pluginhost "github.com/Liapoldus/studio/internal/infrastructure/plugins"
	productdata "github.com/Liapoldus/studio/internal/infrastructure/product"
	projectsource "github.com/Liapoldus/studio/internal/infrastructure/project"
	projectstate "github.com/Liapoldus/studio/internal/infrastructure/projectstate"
	reportstore "github.com/Liapoldus/studio/internal/infrastructure/reports"
	projectsettings "github.com/Liapoldus/studio/internal/infrastructure/settings"
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
	workspace := workspaceapp.New(store, projectsource.Source{Git: gitrepo.Repository{}})
	files := projectfiles.FileSystem{}
	toolRunner, err := pluginhost.NewToolRunnerFromENV()
	if err != nil {
		return err
	}
	trustedKeys, err := pluginhost.ParseTrustRoots(os.Getenv("STUDIO_PLUGIN_TRUST_ROOTS"))
	if err != nil {
		return err
	}
	pluginHost := pluginhost.NewHost(store, toolRunner, pluginhost.Installer{
		Directory:         filepath.Join(filepath.Dir(bootstrap.DatabasePath), "plugins"),
		TrustedKeys:       trustedKeys,
		RequireSignatures: strings.EqualFold(strings.TrimSpace(os.Getenv("STUDIO_PLUGIN_REQUIRE_SIGNATURES")), "true"),
	})
	pluginHost.Sandbox = toolRunner.Sandbox
	pluginHost.SandboxMode = toolRunner.Mode
	app := wailspresentation.NewApp(product.NewProductInfo(productInfo), workspace, desktopintegration.EditorLauncher{}, files, projectsettings.Store{Files: files}, clirunner.Runner{}, reportstore.Store{}, diagnosticstore.Store{}, pluginHost, gitrepo.Repository{}, projectstate.Store{}, store)

	err = wails.Run(&options.App{
		Title:  "Liapoldus Studio",
		Width:  1024,
		Height: 768,
		AssetServer: &assetserver.Options{
			Assets: desktopassets.Files,
		},
		BackgroundColour: &options.RGBA{R: 18, G: 24, B: 33, A: 1},
		OnStartup:        app.Startup,
		Bind: []interface{}{
			app,
		},
	})

	return err
}
