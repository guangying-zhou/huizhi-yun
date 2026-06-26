#!/bin/bash
# Start FastAPI development server with auto-reload

# Activate virtual environment if it exists
if [ -d ".venv_ingest" ]; then
    source .venv_ingest/bin/activate
fi

# Set environment variables
export PYTHONPATH="${PYTHONPATH}:$(pwd)"
export LOG_LEVEL="${LOG_LEVEL:-INFO}"

# Load environment from .env.dev or .env if it exists
if [ -f ".env.dev" ]; then
    echo "Loading environment from .env.dev"
    set -a
    source .env.dev
    set +a
elif [ -f ".env" ]; then
    echo "Loading environment from .env"
    set -a
    source .env
    set +a
fi

# Start uvicorn with auto-reload
echo "Starting FastAPI server on http://localhost:8000"
uvicorn server.python_service.app:app \
    --host 0.0.0.0 \
    --port 8000 \
    --reload \
    --log-level info
