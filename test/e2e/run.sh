#!/usr/bin/env bash
# End-to-end smoke tests: the real CLI in a PTY, with an injected mock Gemini transport and a scratch repo.
set -u
command -v expect >/dev/null || { echo "expect is not installed; skipping e2e tests"; exit 0; }

DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="$DIR/../../bin/git-pilot.js"
FAKE_API="$DIR/fake-api.mjs"
TMP="$(mktemp -d /tmp/git-pilot-e2e.XXXXXX 2>/dev/null || mktemp -d)"
REPO="$TMP/repo"
trap 'rm -rf "$TMP"' EXIT

export GEMINI_API_KEY="test-e2e-gemini-key"
export GIT_PILOT_CONFIG_DIR="$TMP/config"

mkdir -p "$REPO" && cd "$REPO"
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

# Menu navigation: default is "Abort" (4th item), so Enter aborts; Down wraps to "Accept" (1st item)
YES=$'y\r'; NO=$'n\r'; ENTER=$'\r'; ACCEPT=$'\033[B\r'

t "--version"                     -  ""     '[0-9]+\.[0-9]+\.[0-9]+' --version
t "auth: status"                  -  ""     'Authentication Status' auth status

# Test data-sharing notice gate when GEMINI_API_KEY comes from environment on fresh config
t "env-key: decline notice aborts" "Acknowledge sending" "$NO" 'Data-sharing notice was not accepted' run "show status"

# Test fresh config + GEMINI_API_KEY + non-interactive --dry-run (must fail early without prompting, stdout empty)
echo fresh > fresh.txt && git add fresh.txt
FRESH_DRY_OUT="$(node --import "$FAKE_API" "$CLI" --dry-run -m "fresh test" 2>"$TMP/fresh.err")"
FRESH_DRY_CODE=$?
check "fresh --dry-run without consent exits non-zero" test "$FRESH_DRY_CODE" -ne 0
check "fresh --dry-run without consent leaves stdout empty" test -z "$FRESH_DRY_OUT"
check "fresh --dry-run without consent prints setup instructions to stderr" grep -q "Data-sharing notice has not been acknowledged" "$TMP/fresh.err"

# Test fresh config + GEMINI_API_KEY + --dry-run --accept-notice (succeeds non-interactively and persists consent)
FRESH_ACCEPT_OUT="$(node --import "$FAKE_API" "$CLI" --dry-run --accept-notice -m "add b" 2>/dev/null)"
check "fresh --dry-run --accept-notice outputs exact message" test "$FRESH_ACCEPT_OUT" = "feat: add b"
git reset -q HEAD fresh.txt && rm -f fresh.txt

t "run: confirm executes"         "Execute this command?" "$YES" 'Command executed successfully' run "show status"
NO_TTY_SIZE=1 \
t "run: works with 0-column PTY"  "Execute this command?" "$YES" 'Command executed successfully' run "show status"
t "run: decline aborts"           "Execute this command?" "$NO"  'Execution aborted by user' run "show status"
t "run: quoted args survive"      "Execute this command?" "$YES" 'Command executed successfully' run quoted
check "run: quoted message committed intact" test "$(git log -1 --format=%s)" = "two words"
t "run: chained command refused before prompt" - "" 'Refusing to run' run evil
check "run: chained command did not execute" test ! -e PWNED
t "run: non-git command refused"  -  ""     'Refusing to run' run notgit
t "run: global option (-c) refused"   -  ""     'Refusing to run' run dashc
t "run: rebase --exec refused"    -  ""     'Refusing to run' run rebasex
check "run: rebase -x did not execute" test ! -e PWNED
t "run: malformed provider response reported" - "" 'Provider Error' run badresp
GEMINI_API_URL=http://example.com \
t "plain-http remote API refused" -  ""     'must use https' run "show status"
GEMINI_API_URL=https://attacker.example.com \
t "untrusted https host refused"  -  ""     'Refusing to send Gemini API key to untrusted host' run "show status"
GIT_PILOT_TEST_LOCAL=1 GEMINI_API_URL=http://127.0.0.1:9999 \
t "loopback GIT_PILOT_TEST_LOCAL override refused" - "" 'must use https' run "show status"
t "run: provider error reported"  -  ""     'Provider Error:' run boom

t "undo: confirm"                 "Execute this undo command?" "$YES" 'Action successfully undone' undo
check "undo: commit was undone"   test "$(git log -1 --format=%s)" = "init"

t "branch: accept"                "What would you like to do?" "$ACCEPT" 'Switched to new branch' branch "test branch"
check "branch: slugified name"    git rev-parse --verify -q feat/test-branch

git switch -q main && echo b > b.txt && git add b.txt
# Default selection on Enter is Abort (non-destructive)
t "commit: default Enter aborts"  "What would you like to do?" "$ENTER" 'Commit cancelled by user' commit "add b"
check "commit: abort left nothing committed" test "$(git log -1 --format=%s)" = "init"

# Test --dry-run piped stdout byte-for-byte
DRY_OUT="$(node --import "$FAKE_API" "$CLI" --dry-run -m add b 2>/dev/null)"
check "commit: --dry-run stdout is exact message" test "$DRY_OUT" = "feat: add b"

t "commit: accept"                "What would you like to do?" "$ACCEPT" 'Commit created successfully' commit "add b"
check "commit: message used"      test "$(git log -1 --format=%s)" = "feat: add b"

# Test bare git-pilot fast-path (no subcommand)
echo c > c.txt && git add c.txt
t "bare fast path: accept"        "What would you like to do?" "$ACCEPT" 'Commit created successfully' "add c"
check "bare fast path: committed" test "$(git log -1 --format=%s)" = "feat: add b"

# Test secret scanner blocking staged credentials
echo "-----BEGIN RSA PRIVATE KEY-----" > secret.pem && git add secret.pem
t "commit: secret blocked"        -  ""     'SECURITY ALERT' commit
check "commit: secret not committed" test -e secret.pem
git rm -f secret.pem >/dev/null 2>&1

t "commit: nothing staged"        -  ""     'No staged changes found' commit

echo; echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]

