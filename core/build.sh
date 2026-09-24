#!/usr/bin/env sh
# Rebuild the Zig core, pin its SHA-256 in index.html and vendor/SHA256SUMS, then run parity tests.
# Requires Zig 0.16.x (https://ziglang.org/download/). No network access at runtime.
set -eu
cd "$(dirname "$0")"
"${ZIG:-zig}" build-exe src/core.zig -target wasm32-freestanding -fno-entry -rdynamic -O ReleaseFast -fstrip -femit-bin=frameforge-core.wasm
rm -f frameforge-core.wasm.o
HASH=$(sha256sum frameforge-core.wasm | cut -d' ' -f1)
sed -i "s/const FF_CORE_SHA256='[0-9a-f]*'/const FF_CORE_SHA256='$HASH'/" ../index.html
grep -v 'core/frameforge-core.wasm\|core/ffcore-bridge.js' ../vendor/SHA256SUMS > ../vendor/SHA256SUMS.tmp || true
( cd .. && sha256sum core/frameforge-core.wasm core/ffcore-bridge.js ) >> ../vendor/SHA256SUMS.tmp
mv ../vendor/SHA256SUMS.tmp ../vendor/SHA256SUMS
node test/parity.mjs
node test/real-audio.mjs
echo "core sha256 $HASH"
