#!/bin/bash
# Double-click this file to start Milestone Pay and open it in your browser.
# Close this window (or press Ctrl+C) to stop the app.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Get the LTS version from https://nodejs.org, install it, then double-click this file again."
  read -r -p "Press Enter to close."
  exit 1
fi

if [ ! -f .env ]; then
  echo "The .env file with your PayPal and Gemini keys is missing. Copy .env.example to .env and fill it in."
  read -r -p "Press Enter to close."
  exit 1
fi

if [ ! -d node_modules/@paypal/agent-toolkit ] || [ ! -d node_modules/express ]; then
  echo "First run: installing the app's parts (takes about a minute)…"
  npm ci || npm install || { read -r -p "Install failed. Press Enter to close."; exit 1; }
fi

if [ ! -f db.json ] && [ -z "$DB_PATH" ]; then
  echo "First launch: setting up the demo project…"
  node seed.js || { read -r -p "Setup failed. Press Enter to close."; exit 1; }
fi

PORT_NUM=$(grep -E '^PORT=' .env | cut -d= -f2)
PORT_NUM=${PORT_NUM:-3000}

if lsof -ti tcp:"$PORT_NUM" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Milestone Pay already seems to be running. Opening it…"
  open "http://localhost:$PORT_NUM"
  exit 0
fi

(sleep 2; open "http://localhost:$PORT_NUM") &
echo ""
echo "  Milestone Pay is starting at http://localhost:$PORT_NUM"
echo "  Your browser will open by itself."
echo "  Leave this window open while you test. Close it to stop the app."
echo ""
node server.js
