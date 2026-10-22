#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

tooling="$HOME/Desktop/Codex-projects/android-tooling"
if [[ -z "${JAVA_HOME:-}" && -x "/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/java" ]]; then
  export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
fi
if [[ -z "${ANDROID_HOME:-}" ]]; then
  if [[ -d "$tooling/sdk/platforms" ]]; then
    export ANDROID_HOME="$tooling/sdk"
  elif [[ -d "$HOME/Library/Android/sdk" ]]; then
    export ANDROID_HOME="$HOME/Library/Android/sdk"
  fi
fi
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$tooling/gradle-cache}"
export ANDROID_USER_HOME="${ANDROID_USER_HOME:-$tooling/android-user}"
if [[ -z "${ANDROID_HOME:-}" && ! -f local.properties ]]; then
  echo "Open apps/mobile in Android Studio and install Android SDK 37 before building. See README.md." >&2
  exit 1
fi
exec ./gradlew "$@"
