#!/usr/bin/env bash
# Builds "Andromeda.apk" from this folder with the Android SDK's own tools (no Gradle, no libraries).
#
# Needs: a JDK (11 or newer) and the Android SDK with "platforms;android-34" and "build-tools;34.0.0":
#   sdkmanager "platforms;android-34" "build-tools;34.0.0"
# Point ANDROID_HOME (or ANDROID_SDK_ROOT) at the SDK, then run:  ./build.sh
#
# The APK is signed with the key in andromeda-app.keystore in this folder. The first build makes
# that key. Keep the file: Android only installs an update over the app when it is signed with the
# same key (with another key, uninstall the app first). It is not in the repository on purpose.
set -euo pipefail
cd "$(dirname "$0")"

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
[ -n "$SDK" ] && [ -d "$SDK" ] || { echo "Set ANDROID_HOME to your Android SDK folder."; exit 1; }
TOOLS="$SDK/build-tools/${BUILD_TOOLS:-34.0.0}"
JAR="$SDK/platforms/${PLATFORM:-android-34}/android.jar"
[ -x "$TOOLS/aapt2" ] || { echo "Build tools not found in $TOOLS (sdkmanager \"build-tools;34.0.0\")."; exit 1; }
[ -f "$JAR" ] || { echo "Platform not found: $JAR (sdkmanager \"platforms;android-34\")."; exit 1; }

KEYSTORE="${KEYSTORE:-andromeda-app.keystore}"
KEY_PASS="${KEY_PASS:-andromeda}"
OUT="Andromeda.apk"

rm -rf build && mkdir -p build/gen build/classes build/dex
"$TOOLS/aapt2" compile --dir res -o build/res.zip
"$TOOLS/aapt2" link -o build/app.apk -I "$JAR" --manifest AndroidManifest.xml --java build/gen build/res.zip
javac -nowarn -source 11 -target 11 -classpath "$JAR" -d build/classes $(find src build/gen -name '*.java') 2> build/javac.log || { cat build/javac.log; exit 1; }
"$TOOLS/d8" --release --lib "$JAR" --min-api 29 --output build/dex $(find build/classes -name '*.class')
(cd build/dex && zip -q -j ../app.apk classes.dex)
"$TOOLS/zipalign" -f 4 build/app.apk build/aligned.apk

if [ ! -f "$KEYSTORE" ]; then
  echo "Making a signing key: $KEYSTORE (keep this file to be able to update the app later)"
  keytool -genkeypair -keystore "$KEYSTORE" -storepass "$KEY_PASS" -keypass "$KEY_PASS" -alias andromeda \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Andromeda Services" >/dev/null 2>&1
fi
"$TOOLS/apksigner" sign --v2-signing-enabled true --ks "$KEYSTORE" --ks-pass "pass:$KEY_PASS" --key-pass "pass:$KEY_PASS" --ks-key-alias andromeda --out "$OUT" build/aligned.apk
"$TOOLS/apksigner" verify "$OUT"
rm -f "$OUT.idsig"
echo "Built $OUT ($(du -h "$OUT" | cut -f1))"
