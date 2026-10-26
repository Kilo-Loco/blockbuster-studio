SHELL := /bin/bash
.DEFAULT_GOAL := help

NPM ?= npm

# --- Full studio container (own GPU, e.g. RTX 5090) ---
IMAGE ?= docker.io/kiloloco/blockbuster-studio:latest
CONTAINER ?= blockbuster-studio
WORKSPACE ?= $(HOME)/blockbuster-studio
STUDIO_PORT ?= 3000
SHM_SIZE ?= 16g
GPU ?= all
# Extra docker flags, e.g. DOCKER_ENV="-e DOWNLOAD_UPSCALE_MODELS=true"
DOCKER_ENV ?=

.PHONY: help \
	container-check container-pull container-up container-start container-stop \
	container-restart container-logs container-shell container-status container-update container-remove \
	install dev dev-mock dev-tts dev-server dev-web \
	build build-web build-server start test typecheck check validate-workflows clean

help: ## Show this help
	@echo "Blockbuster Studio — local development"
	@awk 'BEGIN {FS = ":.*## "} \
		/^##@/ {printf "\n\033[1m%s\033[0m\n", substr($$0, 5)} \
		/^[a-zA-Z0-9_-]+:.*## / {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo
	@echo "Overrides: NPM=... · IMAGE=... · WORKSPACE=... · STUDIO_PORT=... · DOCKER_ENV=\"-e KEY=value\""
	@echo "Env vars pass through for dev: MOCK_DELAY_MS=0 make dev"

##@ Full studio in Docker (own GPU, e.g. RTX 5090)

container-check: container-pull ## Check the host GPU and Docker GPU access (needs CUDA 12.8+)
	@echo "Host GPU:"
	@nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader \
		|| { echo "nvidia-smi not found: install the NVIDIA driver first."; exit 1; }
	@echo "GPU inside a container:"
	docker run --rm --gpus $(GPU) --entrypoint nvidia-smi $(IMAGE) \
		--query-gpu=name,memory.total --format=csv,noheader

container-pull: ## Pull the studio image
	docker pull $(IMAGE)

container-up: container-pull ## Create or recreate the studio container (keeps /workspace data)
	@mkdir -p "$(WORKSPACE)"
	@docker rm -f $(CONTAINER) >/dev/null 2>&1 || true
	docker run -d --name $(CONTAINER) --gpus $(GPU) --shm-size=$(SHM_SIZE) \
		-p $(STUDIO_PORT):3000 \
		-v "$(WORKSPACE):/workspace" \
		$(DOCKER_ENV) \
		$(IMAGE)
	@echo "Studio: http://localhost:$(STUDIO_PORT) (create your password within 15 minutes)"
	@echo "Models (~128 GB) download in the background; follow them with: make container-logs"

container-start: ## Resume a stopped container (no model re-download)
	docker start $(CONTAINER)

container-stop: ## Stop the container (keeps your models and films)
	docker stop $(CONTAINER)

container-restart: ## Restart the container (reopens the 15-minute setup window if unclaimed)
	docker restart $(CONTAINER)

container-logs: ## Follow the container log
	docker logs -f --tail=200 $(CONTAINER)

container-shell: ## Open a shell inside the container
	docker exec -it $(CONTAINER) bash

container-status: ## Show whether the container is running and its ports
	@docker ps -a --filter name=^/$(CONTAINER)$$ --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'

container-update: container-up ## Pull the latest image and recreate the container
	@echo "Updated. If a newer image was pulled, this container now runs it."

container-remove: ## Delete the container (keeps the WORKSPACE folder on disk)
	docker rm -f $(CONTAINER)

##@ Local development (no GPU)

install: ## Install dependencies
	$(NPM) install

dev: ## Run everything: mock ComfyUI, mock TTS, API server, web app
	$(NPM) run dev

dev-mock: ## Run only the fake ComfyUI (port 8188)
	$(NPM) run dev:mock

dev-tts: ## Run only the fake voice sidecar (port 8190)
	$(NPM) run dev:tts

dev-server: ## Run only the API server with reload (port 3000)
	$(NPM) run dev:server

dev-web: ## Run only the Vite web app (port 5173)
	$(NPM) run dev:web

build: ## Build the web app and the server bundle
	$(NPM) run build

build-web: ## Build the web app into dist/web
	$(NPM) run build:web

build-server: ## Bundle the server into dist/server.js
	$(NPM) run build:server

start: ## Run the built server from dist (requires make build)
	$(NPM) start

test: ## Run the test suite once
	$(NPM) test

typecheck: ## Type-check with tsc
	$(NPM) run typecheck

check: typecheck test ## Type-check and run the tests

validate-workflows: ## Validate workflows against a REAL ComfyUI (needs COMFY_URL)
	$(NPM) run validate:workflows

clean: ## Remove build output (dist)
	rm -rf dist
