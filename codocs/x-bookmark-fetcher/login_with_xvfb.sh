#!/bin/bash
# Login to X using Xvfb (virtual display)
# This allows running the browser on a headless server

echo "Installing Xvfb if not present..."
yum install -y xorg-x11-server-Xvfb 2>/dev/null || apt-get install -y xvfb 2>/dev/null

echo "Starting virtual display and login process..."
echo "Note: You won't see the browser, but it's running in the background."
echo "This script will wait for 5 minutes for you to complete login."
echo ""
echo "If you have VNC access, you can connect to see the browser."
echo "Otherwise, consider using Option 1 (copy session from local)."
echo ""

cd /root/huizhi-yun/codocs/x-bookmark-fetcher
source venv/bin/activate

# Run with Xvfb
xvfb-run -a python first_login.py
