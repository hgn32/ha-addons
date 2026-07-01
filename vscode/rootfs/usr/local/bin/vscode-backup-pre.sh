#!/usr/bin/with-contenv bashio
# shellcheck shell=bash
# ==============================================================================
# Home Assistant Add-on: Studio Code Server
# Cleans up logs and cache before HA backup to reduce backup size.
# ==============================================================================

readonly VSCODE_DATA="/data/vscode"

bashio::log.info "Cleaning VS Code logs and cache before backup..."

for dir in \
    "${VSCODE_DATA}/logs" \
    "${VSCODE_DATA}/User/logs" \
    "${VSCODE_DATA}/User/History" \
    "${VSCODE_DATA}/Cache" \
    "${VSCODE_DATA}/CachedData" \
    "${VSCODE_DATA}/CachedExtensionVSIXs" \
    "${VSCODE_DATA}/cachedb" \
    "${VSCODE_DATA}/crashDumps"; do
    if [ -d "${dir}" ]; then
        rm -rf "${dir:?}"/*
        bashio::log.info "Cleared: ${dir}"
    fi
done

if [ -f /data/.zsh_history ]; then
    rm -f /data/.zsh_history
    bashio::log.info "Cleared: /data/.zsh_history"
fi

bashio::log.info "Pre-backup cleanup done."
