.PHONY: install check check-race lint lint-go lint-frontend test bindings-check desktop-dev desktop-build web-build web-binary web-run
.NOTPARALLEL:

export GOWORK := off
export GOFLAGS ?= -p=1

GOLANGCI_LINT_VERSION := v2.5.0
GOLANGCI_LINT := .tools/golangci-lint-$(GOLANGCI_LINT_VERSION)/golangci-lint
GO_PACKAGES := . ./cmd/... ./internal/...

install:
	cd frontend && npm ci

test:
	go test $(GO_PACKAGES)
	cd frontend && npx tsc --project tsconfig.eslint.json
	cd frontend && npm test

$(GOLANGCI_LINT):
	mkdir -p "$(dir $(GOLANGCI_LINT))"
	GOBIN="$(CURDIR)/$(dir $(GOLANGCI_LINT))" go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@$(GOLANGCI_LINT_VERSION)

lint-go: $(GOLANGCI_LINT)
	test "$$($(GOLANGCI_LINT) version --short)" = "$(patsubst v%,%,$(GOLANGCI_LINT_VERSION))"
	"$(GOLANGCI_LINT)" version
	"$(GOLANGCI_LINT)" config verify --schema tools/lint/schema.json
	"$(GOLANGCI_LINT)" run $(GO_PACKAGES)
	"$(GOLANGCI_LINT)" fmt --diff $(GO_PACKAGES)

lint-frontend:
	cd frontend && npm run lint

lint: lint-go lint-frontend

check:
	cd frontend && npm run build
	cd frontend && npm run build:web
	$(MAKE) bindings-check
	$(MAKE) lint test
	go vet $(GO_PACKAGES)
	go build $(GO_PACKAGES)

check-race:
	go test -race $(GO_PACKAGES)

bindings-check:
	cd frontend && npm run bindings:check

desktop-dev:
	@studio_status=0; wails dev || studio_status=$$?; \
	(cd frontend && npm run bindings:prepare) || exit $$?; exit $$studio_status

desktop-build:
	cd frontend && npm run desktop:build
	$(MAKE) bindings-check lint

web-build:
	cd frontend && npm run build:web

web-binary: web-build
	mkdir -p build/bin
	go build -o build/bin/studio-web ./cmd/web

web-run: web-build
	go run ./cmd/web
