#!/bin/bash
rm -rf ./server/python_service/__pycache__
rm -rf ./server/scripts/__pycache__
source .venv/bin/activate
pkill -9 uvicorn
uvicorn server.python_service.app:app --host 0.0.0.0 --port 8090 &
