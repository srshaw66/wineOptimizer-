#!/bin/bash
# Double-click to start VineyardOS (backend + frontend) and open it in your browser.
# Close this window or press Ctrl+C to stop everything.
#
# - Uses ports 8000 / 5173 when free; otherwise picks the next free port (it never stops other programs).
# - First run creates backend/.venv and installs frontend packages (needs internet once).
# - Set NO_OPEN=1 to skip opening the browser.

cd "$(dirname "$0")/.." || exit 1
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

port_busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
free_port() {
  local p="$1"
  while port_busy "$p"; do p=$((p + 1)); done
  echo "$p"
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
command -v python3 >/dev/null 2>&1 || fail "Python 3 is not installed." "Install Python 3.10+ from https://www.python.org/downloads/ and try again."
command -v npm >/dev/null 2>&1 || fail "Node.js (npm) is not installed." "Install Node.js 20+ from https://nodejs.org/ and try again."

# ---------- backend setup ----------
cd "$ROOT/backend" || fail "backend folder not found."
if [ ! -x .venv/bin/python ]; then
  say "First run: creating the Python environment…"
  python3 -m venv .venv || fail "Could not create backend/.venv."
  .venv/bin/python -m pip install --quiet --upgrade pip
  .venv/bin/python -m pip install --quiet -r requirements.txt || fail "Installing backend packages failed." "Check your internet connection and try again."
fi

# ---------- frontend setup ----------
cd "$ROOT/frontend" || fail "frontend folder not found."
if [ ! -d node_modules ]; then
  say "First run: installing frontend packages…"
  npm install --silent || fail "Installing frontend packages failed." "Check your internet connection and try again."
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
VINEYARD_API_URL="http://127.0.0.1:$BACKEND_PORT" npx vite --host 127.0.0.1 --port "$FRONTEND_PORT" --strictPort >"$LOG_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!

# ---------- wait until both answer ----------
URL="http://127.0.0.1:$FRONTEND_PORT"
for _ in $(seq 1 60); do
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
[ -n "${READY:-}" ] || fail "VineyardOS did not start within 60 seconds." "See the logs in $LOG_DIR."

say "VineyardOS is running at $URL"
echo "    API docs: http://127.0.0.1:$BACKEND_PORT/docs"
echo "    Logs:     $LOG_DIR"
echo
echo "Leave this window open while presenting. Close it or press Ctrl+C to stop."
[ -z "${NO_OPEN:-}" ] && open "$URL"

wait
