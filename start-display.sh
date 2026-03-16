#!/bin/bash
# Start the Tamagotchi Display

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT=8793

# Check if already running
if pgrep -f "serve.py" > /dev/null; then
    echo "Display server already running"
    exit 0
fi

# Start the server in background
cd "$SCRIPT_DIR"
python3 serve.py &
SERVER_PID=$!
sleep 1

# Check if server started successfully
if kill -0 $SERVER_PID 2>/dev/null; then
    echo "Display server started (PID: $SERVER_PID)"
    echo "Opening browser..."
    
    # Try to open in browser (fullscreen kiosk mode for display)
    if command -v chromium-browser &> /dev/null; then
        chromium-browser --kiosk --noerrdialogs --disable-infobars \
            --disable-session-crashed-bubble --disable-restore-session-state \
            "http://localhost:$PORT" &
    elif command -v chromium &> /dev/null; then
        chromium --kiosk --noerrdialogs --disable-infobars \
            "http://localhost:$PORT" &
    elif command -v firefox &> /dev/null; then
        firefox --kiosk "http://localhost:$PORT" &
    elif command -v xdg-open &> /dev/null; then
        xdg-open "http://localhost:$PORT" &
    else
        echo "Open http://localhost:$PORT in your browser"
    fi
else
    echo "Failed to start display server"
    exit 1
fi
