#!/usr/bin/env bash
# End-to-end smoke tests: the real CLI in a PTY, against a fake API and a scratch repo.
set -u
command -v expect >/dev/null || { echo "expect is not installed; skipping e2e tests"; exit 0; }

DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="$DIR/../../bin/git-pilot.js"
TMP="$(mktemp -d)"
REPO="$TMP/repo"
trap 'kill $API_PID 2>/dev/null; wait $API_PID 2>/dev/null; rm -rf "$TMP"' EXIT

node "$DIR/fake-api.mjs" "$TMP/port" & API_PID=$!
for _ in $(seq 50); do [ -s "$TMP/port" ] && break; sleep 0.1; done
export GIT_PILOT_API_URL="http://127.0.0.1:$(cat "$TMP/port")"

mkdir "$REPO" && cd "$REPO"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
git init -q -b main && echo a > a.txt && git add a.txt && git commit -qm init

pass=0; fail=0
# t <name> <prompt|-> <answer> <expected-regex> <cli args...>
t() {
  local name=$1; shift
  if out=$(expect "$DIR/flow.exp" "$CLI" "$REPO" "$@" 2>&1); then pass=$((pass+1)); echo "ok    $name"
  else fail=$((fail+1)); echo "FAIL  $name: $out"; fi
}
check() { # check <name> <command...>
  local name=$1; shift
  if "$@" >/dev/null 2>&1; then pass=$((pass+1)); echo "ok    $name"; else fail=$((fail+1)); echo "FAIL  $name"; fi
}
YES=$'y\r'; NO=$'n\r'; ENTER=$'\r'; ABORT=$'\033[B\033[B\r'

t "--version"                     -  ""     '[0-9]+\.[0-9]+\.[0-9]+' --version
t "run: confirm executes"         "Execute this command?" "$YES" 'executed successfully' run "show status"
NO_TTY_SIZE=1 \
t "run: works with 0-column PTY"  "Execute this command?" "$YES" 'executed successfully' run "show status"
t "run: decline aborts"           "Execute this command?" "$NO"  'aborted by user' run "show status"
t "run: quoted args survive"      "Execute this command?" "$YES" 'executed successfully' run quoted
check "run: quoted message committed intact" test "$(git log -1 --format=%s)" = "two words"
t "run: chained command refused before prompt" - "" 'Refusing to run' run evil
check "run: chained command did not execute" test ! -e PWNED
t "run: non-git command refused"  -  ""     'Refusing to run' run notgit
t "run: global option (-c) refused"   -  ""     'Refusing to run' run dashc
t "run: rebase --exec refused"    -  ""     'Refusing to run' run rebasex
check "run: rebase -x did not execute" test ! -e PWNED
t "run: malformed API response reported" - "" 'Unexpected response' run badresp
GIT_PILOT_API_URL=http://example.com \
t "plain-http remote API refused" -  ""     'must use https' run "show status"
t "run: API error reported"       -  ""     'API Error: 500' run boom

t "undo: confirm"                 "Execute this undo command?" "$YES" 'successfully undone' undo
check "undo: commit was undone"   test "$(git log -1 --format=%s)" = "init"

t "branch: accept"                "What would you like to do?" "$ENTER" 'Switched to new branch' branch "test branch"
check "branch: slugified name"    git rev-parse --verify -q feat/test-branch

git switch -q main && echo b > b.txt && git add b.txt
t "commit: abort"                 "What would you like to do?" "$ABORT" 'aborted by user' commit "add b"
check "commit: abort left nothing committed" test "$(git log -1 --format=%s)" = "init"
t "commit: accept"                "What would you like to do?" "$ENTER" 'Commit successful' commit "add b"
check "commit: message used"      test "$(git log -1 --format=%s)" = "feat: add b"
t "commit: nothing staged"        -  ""     'No staged changes' commit

echo; echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
