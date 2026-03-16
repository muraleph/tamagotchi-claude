#!/bin/bash
# Update the tamagotchi display status
# Usage: ./update-status.sh [state] [activity] [subagent]
# Examples:
#   ./update-status.sh                          # Reset to idle
#   ./update-status.sh working "Running task"   # Set working state
#   ./update-status.sh working "" my-subagent   # Set subagent active

SCRIPT_DIR="$(dirname "$(realpath "$0")")"
STATUS_FILE="$SCRIPT_DIR/status.json"

STATE="${1:-idle}"
ACTIVITY="${2:-Waiting for messages}"
SUBAGENT="${3:-null}"

# Handle null subagent
if [ "$SUBAGENT" = "null" ] || [ -z "$SUBAGENT" ]; then
    SUBAGENT_JSON="null"
else
    SUBAGENT_JSON="\"$SUBAGENT\""
fi

# Write status.json
cat > "$STATUS_FILE" << EOF
{
  "state": "$STATE",
  "activity": "$ACTIVITY",
  "subagent": $SUBAGENT_JSON,
  "sessions": 1,
  "lastUpdate": "$(date -Iseconds)"
}
EOF

echo "Status updated: $STATE - $ACTIVITY"
