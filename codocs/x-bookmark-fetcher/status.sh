#!/bin/bash
# Check bookmark fetcher service status
# Usage: ./status.sh

echo "=== Bookmark Fetcher Service Status ==="
echo ""

# Check if port is listening
if lsof -Pi :8001 -sTCP:LISTEN -t >/dev/null ; then
    echo "✓ Service is running on port 8001"
    
    # Get PID
    PID=$(lsof -ti:8001)
    echo "  PID: $PID"
    
    # Get uptime
    if ps -p $PID -o etime= >/dev/null 2>&1; then
        UPTIME=$(ps -p $PID -o etime= | tr -d ' ')
        echo "  Uptime: $UPTIME"
    fi
    
    echo ""
    
    # Check API status
    echo "API Status:"
    if curl -s http://localhost:8001/status >/dev/null 2>&1; then
        echo "✓ API is responding"
        curl -s http://localhost:8001/status | python3 -m json.tool 2>/dev/null | sed 's/^/  /'
    else
        echo "✗ API is not responding"
    fi
    
    echo ""
    echo "Recent logs (last 10 lines):"
    tail -10 /tmp/fetcher.log | sed 's/^/  /'
    
else
    echo "✗ Service is not running"
    echo ""
    echo "Start with: ./start.sh"
fi

echo ""
