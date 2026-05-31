#!/bin/bash

PORT_FRONTEND=3000
PORT_BACKEND=5001
PID_FILE=".server.pid"

echo "Stopping SectorTrend servers..."

# 1. Try stopping via recorded PIDs
if [ -f "$PID_FILE" ]; then
    echo "Found $PID_FILE. Terminating processes..."
    while IFS= read -r pid; do
        if kill -0 "$pid" > /dev/null 2>&1; then
            echo "Killing process PID: $pid..."
            kill -9 "$pid"
        else
            echo "Process PID $pid is not running."
        fi
    done < "$PID_FILE"
    rm "$PID_FILE"
fi

# 2. Resilient backup check using port scanning
echo "Performing backup scan on ports $PORT_FRONTEND and $PORT_BACKEND..."
for port in $PORT_FRONTEND $PORT_BACKEND; do
    PIDS=$(lsof -t -i :$port 2>/dev/null)
    if [ -n "$PIDS" ]; then
        echo "Found leftover processes listening on port $port. Terminating PIDs: $PIDS..."
        echo "$PIDS" | xargs kill -9 > /dev/null 2>&1
    fi
done

echo "🛑 All servers stopped successfully."
