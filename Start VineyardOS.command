#!/usr/bin/env bash
# Start VineyardOS (backend + frontend) and open it in your default web browser.
#
#   macOS:  double-click this file (first time: right-click → Open, then Open).
#   Linux:  run  ./"Start VineyardOS.command"  (or: bash "Start VineyardOS.command")
#
# Close this window or press Ctrl+C to stop everything.
#  - Needs Python 3.9+ and Node.js 18+ (20 recommended). The first run installs packages (internet needed once).
#  - Uses ports 8000 / 5173 when free; otherwise the next free port. It never stops other programs.
#  - Set NO_OPEN=1 to skip opening the browser.

cd "$(dirname "$0")" || exit 1
ROOT="$(pwd)"
LOG_DIR="$ROOT/.run-logs"
mkdir -p "$LOG_DIR"

say() { printf '\n\033[1;32m==>\033[0m %s\n' "$1"; }
fail() {
  printf '\n\033[1;31mProblem:\033[0m %s\n' "$1"
  [ -n "${2:-}" ] && printf '%s\n' "$2"
  printf '\nPress Return to close this window.'
  read -r _
  exit 1
}

BACKEND_PID=""
FRONTEND_PID=""
cleanup() {
  trap - INT TERM HUP EXIT
  echo
  say "Stopping VineyardOS…"
  [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null
  [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null
  wait 2>/dev/null
  echo "Stopped."
}
trap cleanup INT TERM HUP EXIT

# ---------- prerequisites ----------
PY="$(command -v python3 || true)"
[ -n "$PY" ] || fail "Python 3 is not installed." "Install Python 3.9 or newer from https://www.python.org/downloads/ and try again."
"$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' \
  || fail "Python 3.9 or newer is required (found $("$PY" --version 2>&1))." "Install a newer Python from https://www.python.org/downloads/."
command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 \
  || fail "Node.js is not installed." "Install Node.js 20 (LTS) from https://nodejs.org/ and try again."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] 2>/dev/null || fail "Node.js 18 or newer is required (found $(node --version))." "Install Node.js 20 (LTS) from https://nodejs.org/."
command -v curl >/dev/null 2>&1 || fail "curl is not installed." "Install curl and try again."

fingerprint() { "$PY" -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$1"; }
port_free() { "$PY" -c 'import socket,sys; s=socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); s.bind(("127.0.0.1", int(sys.argv[1]))); s.close()' "$1" 2>/dev/null; }
free_port() {
  local p="$1"
  while ! port_free "$p"; do p=$((p + 1)); done
  echo "$p"
}

# ---------- backend setup ----------
cd "$ROOT/backend" || fail "backend folder not found."
if [ ! -x .venv/bin/python ]; then
  say "First run: creating the Python environment…"
  "$PY" -m venv .venv || fail "Could not create backend/.venv." "On Debian/Ubuntu: sudo apt install python3-venv"
fi
REQ_FP="$(fingerprint requirements.txt)"
if [ "$(cat .venv/.vineyardos-requirements 2>/dev/null)" != "$REQ_FP" ]; then
  say "Installing backend packages…"
  .venv/bin/python -m pip install --quiet --upgrade pip >/dev/null 2>&1
  .venv/bin/python -m pip install --quiet -r requirements.txt \
    || fail "Installing backend packages failed." "Check your internet connection and try again."
  echo "$REQ_FP" > .venv/.vineyardos-requirements
fi

# ---------- frontend setup ----------
cd "$ROOT/frontend" || fail "frontend folder not found."
LOCK_FP="$(fingerprint package-lock.json)"
if [ ! -d node_modules ] || [ "$(cat node_modules/.vineyardos-lock 2>/dev/null)" != "$LOCK_FP" ]; then
  say "Installing frontend packages…"
  npm install --no-audit --no-fund --silent \
    || fail "Installing frontend packages failed." "Check your internet connection and try again."
  echo "$LOCK_FP" > node_modules/.vineyardos-lock
fi

# ---------- start ----------
BACKEND_PORT="$(free_port 8000)"
FRONTEND_PORT="$(free_port 5173)"
[ "$BACKEND_PORT" != 8000 ] && echo "Port 8000 is in use by another program; using $BACKEND_PORT for the backend."
[ "$FRONTEND_PORT" != 5173 ] && echo "Port 5173 is in use by another program; using $FRONTEND_PORT for the app."

say "Starting backend on port $BACKEND_PORT…"
cd "$ROOT/backend"
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port "$BACKEND_PORT" >"$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!

say "Starting app on port $FRONTEND_PORT…"
cd "$ROOT/frontend"
VINEYARD_API_URL="http://127.0.0.1:$BACKEND_PORT" ./node_modules/.bin/vite --host 127.0.0.1 --port "$FRONTEND_PORT" --strictPort >"$LOG_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!

# ---------- wait until both answer ----------
URL="http://127.0.0.1:$FRONTEND_PORT"
for _ in $(seq 1 90); do
  kill -0 "$BACKEND_PID" 2>/dev/null || fail "The backend stopped while starting." "Last lines of $LOG_DIR/backend.log:
$(tail -n 15 "$LOG_DIR/backend.log")"
  kill -0 "$FRONTEND_PID" 2>/dev/null || fail "The app stopped while starting." "Last lines of $LOG_DIR/frontend.log:
$(tail -n 15 "$LOG_DIR/frontend.log")"
  if curl -s -m 2 "http://127.0.0.1:$BACKEND_PORT/api/health" >/dev/null && curl -s -m 2 "$URL" >/dev/null; then
    READY=1
    break
  fi
  sleep 1
done
[ -n "${READY:-}" ] || fail "VineyardOS did not start within 90 seconds." "See the logs in $LOG_DIR."

say "VineyardOS is running at $URL"
echo "    API docs: http://127.0.0.1:$BACKEND_PORT/docs"
echo "    Logs:     $LOG_DIR"
echo
echo "Leave this window open while presenting. Close it or press Ctrl+C to stop."

# ---------- open in the default browser ----------
open_browser() {
  case "$(uname -s)" in
    Darwin) open "$1" ;;                                    # macOS default browser
    Linux)
      if grep -qi microsoft /proc/version 2>/dev/null && command -v wslview >/dev/null 2>&1; then wslview "$1"  # WSL → Windows default
      elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$1" >/dev/null 2>&1                                # Linux desktop default
      else return 1; fi ;;
    *) return 1 ;;
  esac
}
if [ -z "${NO_OPEN:-}" ]; then
  open_browser "$URL" || echo "Open $URL in your browser."
fi

wait
