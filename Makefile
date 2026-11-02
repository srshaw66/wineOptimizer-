SHELL := /bin/sh

.PHONY: run

run:
	@trap 'kill 0' INT TERM EXIT; \
	./scripts/start-backend.sh & \
	./scripts/start-frontend.sh & \
	wait
