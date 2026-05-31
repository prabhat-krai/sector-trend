#!/bin/bash

# Configuration
PORT_FRONTEND=3000
PORT_BACKEND=5001
PID_FILE=".server.pid"

echo "Checking if servers are already running..."

# Check if ports are already occupied
if lsof -i :$PORT_FRONTEND -i :$PORT_BACKEND > /dev/null 2>&1; then
    echo "⚠️ Warning: Process is already listening on port $PORT_FRONTEND or $PORT_BACKEND."
    echo "Please run ./stop_servers.sh first to clear them."
    exit 1
fi

echo "Starting SectorTrend backend server on port $PORT_BACKEND..."
npm run server > backend.log 2>&1 &
BACKEND_PID=$!

echo "Starting SectorTrend frontend client on port $PORT_FRONTEND..."
npm run client > frontend.log 2>&1 &
FRONTEND_PID=$!

# Record PIDs
echo "$BACKEND_PID" > "$PID_FILE"
echo "$FRONTEND_PID" >> "$PID_FILE"

echo "🚀 Servers started successfully!"
echo "  - Frontend: http://localhost:$PORT_FRONTEND (Logs: frontend.log, PID: $FRONTEND_PID)"
echo "  - Backend: http://localhost:$PORT_BACKEND (Logs: backend.log, PID: $BACKEND_PID)"
echo "Process IDs saved to $PID_FILE"
