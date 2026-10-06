#!/usr/bin/env bash
set -euo pipefail

SOURCE_SHA="${1:?source SHA is required}"
IMAGE_TAG="qf-phase16:${SOURCE_SHA}"

# Phase 16 certification builds a reviewed local artifact only. These are inert
# compile-time placeholders under the reserved .invalid domain; no provider
# credential is read and no external environment is contacted by this script.
docker build --pull=false \
  --build-arg GIT_SHA="${SOURCE_SHA}" \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="https://phase16-ci.invalid" \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="phase16-ci-only-anon-key" \
  -t "${IMAGE_TAG}" .
