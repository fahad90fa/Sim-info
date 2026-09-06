#!/usr/bin/env bash
# Test double for a Chromium binary: fails the first FLAKY_FAIL_FIRST launches
# (default 1), then execs the real browser. Every invocation is appended to
# FLAKY_LOG so tests can count launch attempts.
set -u
log="${FLAKY_LOG:?FLAKY_LOG must be set}"
echo "$(date +%s%N)" >> "$log"
count=$(wc -l < "$log")
if [ "$count" -le "${FLAKY_FAIL_FIRST:-1}" ]; then
  echo "flaky-chromium: simulated launch failure #$count" >&2
  exit 1
fi
exec "${FLAKY_REAL_CHROMIUM:?FLAKY_REAL_CHROMIUM must be set}" "$@"
