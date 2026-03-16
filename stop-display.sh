#!/bin/bash
# Stop the Tamagotchi Display server

pkill -f "serve.py" 2>/dev/null && echo "Display server stopped" || echo "Server not running"
