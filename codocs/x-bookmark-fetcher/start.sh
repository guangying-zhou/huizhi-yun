#!/bin/bash
# Start the bookmark fetcher service
# Usage: ./start.sh

cd "$(dirname "$0")"

# Check if already running
if lsof -Pi :8001 -sTCP:LISTEN -t >/dev/null ; then
    echo "Service is already running on port 8001"
    exit 0
fi

# Activate virtual environment and start service
source venv/bin/activate

echo "Starting bookmark fetcher service on port 8001..."
nohup python -m uvicorn app.main:app --host 0.0.0.0 --port 8001 > /tmp/fetcher.log 2>&1 &

# Wait for startup and check multiple times
MAX_ATTEMPTS=10
ATTEMPT=0

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    sleep 1
    ATTEMPT=$((ATTEMPT + 1))
    
    if lsof -Pi :8001 -sTCP:LISTEN -t >/dev/null ; then
        echo "✓ Service started successfully (took ${ATTEMPT}s)"
        echo "Log file: /tmp/fetcher.log"
        echo "Status: curl http://localhost:8001/status"
        exit 0
    fi
    
    echo -n "."
done

echo ""
echo "✗ Failed to start service after ${MAX_ATTEMPTS}s"
echo "Check log: tail -50 /tmp/fetcher.log"
exit 1
