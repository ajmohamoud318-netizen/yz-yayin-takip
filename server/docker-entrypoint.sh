#!/bin/sh
# Container entrypoint for the Fastify backend.
#
# Runs as root (the default for `docker run` and Dokploy-managed
# containers), prepares the on-disk state that the app expects, then
# drops to the unprivileged `node` user to actually run the server.
# The drop keeps the runtime blast-radius of any compromise in app
# code down to a single directory.
#
# What this script does:
#   1. mkdir the avatar upload directory at $AVATAR_DIR (default
#      /app/.yz-uploads/avatars)
#   2. chown -R the dir to UID:GID 1000:1000 so the runtime can write
#      even when a Dokploy mounted volume lands root-owned
#      (which is the platform default — the named volume gets created
#      on the host with UID 0)
#   3. chmod 0o770 — group-scoped access for the `node` user without
#      leaking the dir to other system users
#   4. exec gosu node:node node src/index.js
#
# We use `gosu` from the `node:20-alpine` package repository (added
# in the Dockerfile); `su-exec` works equally well if your base image
# ships it instead.
#
# This is intentionally idempotent — restart-as-the-same-container,
# restart-after-redeploy, and first-boot all produce the same final
# state. mkdir/chown/chmod silently no-op when the dir already exists
# with the right ownership.

set -eu

AVATAR_DIR="${AVATAR_DIR:-/app/.yz-uploads/avatars}"

# 1. Create the upload directory if it isn't there yet. mkdir -p is
#    safe to run on a mounted volume — it only creates the leaf and
#    any missing parents, never touches existing files.
mkdir -p "$AVATAR_DIR"

# 2. chown / chmod. These require root, so this whole script runs as
#    root. We try to chown the *parent* too if the avatar dir is the
#    only thing inside — that's the common Dokploy layout (volume
#    mounted at the avatar dir or one level up) and we want to fix
#    both layers so an upload can later create subdirs without EACCES.
PARENT_DIR="$(dirname "$AVATAR_DIR")"
for path in "$PARENT_DIR" "$AVATAR_DIR"; do
    if [ -d "$path" ]; then
        chown 1000:1000 "$path" 2>/dev/null || true
        chmod 770 "$path" 2>/dev/null || true
    fi
done

# 3. Drop to the unprivileged node user and exec the server.
#    `exec` is essential — otherwise the entrypoint stays PID 1 and
#    SIGTERM goes to the script instead of Fastify, breaking
#    graceful shutdown.
exec gosu node:node node src/index.js "$@"
