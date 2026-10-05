#!/bin/bash
# Setup cookies for X bookmark fetcher

cd /root/huizhi-yun/codocs/x-bookmark-fetcher

echo "=========================================="
echo "X Bookmark Fetcher - Cookie Setup"
echo "=========================================="
echo ""

# Check if cookies.json exists
if [ ! -f "cookies.json" ]; then
    echo "❌ Error: cookies.json not found!"
    echo ""
    echo "Please export cookies from Chrome using an extension like:"
    echo "  - EditThisCookie"
    echo "  - Cookie-Editor"
    echo ""
    echo "Then upload the cookies.json file to this directory."
    exit 1
fi

echo "✓ Found cookies.json"
echo ""

# Activate virtual environment
source venv/bin/activate

# Convert cookies
echo "Converting cookies to Playwright format..."
python convert_cookies.py

if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Conversion failed!"
    exit 1
fi

echo ""
echo "=========================================="
echo "✓ Setup complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Restart the service: ./stop.sh && ./start.sh"
echo "2. Test the sync: curl -X POST http://localhost:8001/sync"
echo "3. Check logs: tail -f /tmp/fetcher.log"
echo ""
