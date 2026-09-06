#!/bin/bash
cd "$(dirname "$0")" || exit 1
if ! command -v python3 >/dev/null 2>&1; then
  echo "Install Python 3.10 or newer from python.org, then open this launcher again."
  read -r -p "Press Return to close."
  exit 1
fi
python3 lecture-desk/server.py
