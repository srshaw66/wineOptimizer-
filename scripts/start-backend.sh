#!/bin/sh
set -eu
cd "$(dirname "$0")/../backend"
if [ ! -d .venv ]; then python3 -m venv .venv; fi
. .venv/bin/activate
python -m pip install -r requirements.txt
exec python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
