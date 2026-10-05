.PHONY: install check desktop-dev desktop-build web-build web-binary web-config web-run

install:
	cd frontend && npm ci

check:
	go test ./...
	go vet ./...
	go build ./...
	cd frontend && npm run build
	cd frontend && npm run build:web

desktop-dev:
	@set -eu; \
	cd cmd/desktop; \
	test ! -e wails.json; \
	cp ../../configs/wails.json wails.json; \
	trap 'rm -f wails.json' EXIT; \
	wails dev

desktop-build:
	@set -eu; \
	cd cmd/desktop; \
	test ! -e wails.json; \
	cp ../../configs/wails.json wails.json; \
	trap 'rm -f wails.json' EXIT; \
	wails build

web-build:
	cd frontend && npm run build:web

web-binary: web-build
	mkdir -p build/bin
	go build -o build/bin/studio-web ./cmd/web

web-config:
	test -e configs/studio-web.json || cp configs/studio-web.example.json configs/studio-web.json

web-run: web-build web-config
	go run ./cmd/web -config configs/studio-web.json
