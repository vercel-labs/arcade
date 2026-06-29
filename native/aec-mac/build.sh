#!/usr/bin/env bash
# Build the VPIO AEC sidecar. Embeds Info.plist into the binary via -sectcreate so
# the microphone TCC prompt has its NSMicrophoneUsageDescription (a bare CLI
# executable has no Info.plist otherwise). No Apple account / signing needed to
# build and run locally; the binary is ad-hoc/unsigned.
set -euo pipefail
cd "$(dirname "$0")"

swiftc Sources/main.swift -O -o aec-mac \
  -framework AudioToolbox \
  -framework AVFoundation \
  -framework CoreAudio \
  -framework Foundation \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker Info.plist

echo "built ./aec-mac"
