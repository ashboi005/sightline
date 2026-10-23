#!/bin/sh
set -eu
project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
mkdir -p "$project_dir/.pio/host-tests"
"${CXX:-clang++}" -std=c++11 -Wall -Wextra -Werror -fsanitize=address,undefined \
  -I"$project_dir/src" \
  "$project_dir/src/servo_command.cpp" "$project_dir/test/servo/test_command.cpp" \
  -o "$project_dir/.pio/host-tests/servo-command-tests"
"$project_dir/.pio/host-tests/servo-command-tests"
"${CXX:-clang++}" -std=c++11 -Wall -Wextra -Werror -fsanitize=address,undefined \
  -I"$project_dir/src" -I"$project_dir/test/servo_runtime/stubs" \
  "$project_dir/src/servo_module.cpp" "$project_dir/src/servo_command.cpp" \
  "$project_dir/test/servo_runtime/test_runtime.cpp" \
  -o "$project_dir/.pio/host-tests/servo-runtime-tests"
"$project_dir/.pio/host-tests/servo-runtime-tests"
"${CXX:-clang++}" -std=c++11 -Wall -Wextra -Werror -fsanitize=address,undefined \
  -I"$project_dir/src" "$project_dir/test/validation/test_url.cpp" \
  -o "$project_dir/.pio/host-tests/validation-url-tests"
"$project_dir/.pio/host-tests/validation-url-tests"
