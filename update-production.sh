#!/bin/sh

set -eu

PROJECT_DIR="${PROJECT_DIR:-/mnt/main/websites/portfolio-tom}"
LOCK_DIR="${PROJECT_DIR}/.update-lock"
if [ "$(id -u)" -eq 0 ]; then
  DOCKER=""
else
  DOCKER="sudo"
fi

if [ ! -d "$PROJECT_DIR" ]; then
  echo "Project directory does not exist: $PROJECT_DIR" >&2
  exit 1
fi

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Another production update is already running."
  exit 0
fi

cleanup() {
  rmdir "$LOCK_DIR"
}
trap cleanup EXIT

cd "$PROJECT_DIR"

if [ ! -d .git ]; then
  echo "This updater requires a Git checkout: $PROJECT_DIR" >&2
  exit 1
fi

before="$(git rev-parse HEAD)"
git pull --ff-only
after="$(git rev-parse HEAD)"

if [ "$before" = "$after" ]; then
  echo "No source changes. Production container is unchanged."
  exit 0
fi

$DOCKER docker compose build
$DOCKER docker compose up -d --remove-orphans
$DOCKER docker image prune -f

echo "Production updated from $before to $after."
