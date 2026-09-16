#!/bin/bash
# Stop the bookmark fetcher service
# Usage: ./stop.sh

cd "$(dirname "$0")"

echo "Stopping bookmark fetcher service..."

# Find and kill the process
PID=$(lsof -ti:8001)

if [ -z "$PID" ]; then
    echo "Service is not running"
else
    kill $PID 2>/dev/null
    sleep 2

    # Check if stopped
    if lsof -Pi :8001 -sTCP:LISTEN -t >/dev/null ; then
        echo "Force killing..."
        kill -9 $PID 2>/dev/null
    fi
    echo "✓ Service stopped"
fi

# Clean up orphaned Chrome processes belonging to x-session
SESSION_DIR="$(pwd)/x-session"
CHROME_PIDS=$(pgrep -f "user-data-dir=${SESSION_DIR}" 2>/dev/null)

if [ -n "$CHROME_PIDS" ]; then
    echo "Cleaning up orphaned Chrome processes..."
    echo "$CHROME_PIDS" | xargs kill 2>/dev/null
    sleep 2
    # Force kill any survivors
    REMAINING=$(pgrep -f "user-data-dir=${SESSION_DIR}" 2>/dev/null)
    if [ -n "$REMAINING" ]; then
        echo "$REMAINING" | xargs kill -9 2>/dev/null
    fi
    echo "✓ Chrome processes cleaned up"
else
    echo "No orphaned Chrome processes found"
fi
