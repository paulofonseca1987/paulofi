#!/bin/bash

# Background Sync Script for Voting Power Tracker
# This script triggers the background sync and runs independently of the browser

echo "🚀 Starting background sync..."
echo "📊 Monitor progress at: http://localhost:3000"
echo ""

# Get the sync secret from .env.local
SYNC_SECRET=$(grep SYNC_SECRET .env.local | cut -d '=' -f2)

if [ -z "$SYNC_SECRET" ]; then
    echo "❌ Error: SYNC_SECRET not found in .env.local"
    exit 1
fi

echo "🔄 Triggering background sync endpoint..."
echo "⏰ Started at: $(date)"
echo ""

# Call the background sync endpoint
response=$(curl -s -w "\n%{http_code}" -X POST http://localhost:3000/api/sync/background \
    -H "X-Sync-Token: $SYNC_SECRET" \
    -H "Content-Type: application/json")

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | head -n-1)

echo "📡 Response code: $http_code"
echo ""

if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 409 ]; then
    echo "✅ Sync initiated successfully!"
    echo ""
    echo "$body" | jq . 2>/dev/null || echo "$body"
    echo ""
    echo "💡 Tips:"
    echo "  - Refresh http://localhost:3000 to see progress"
    echo "  - Sync runs in the background on the Next.js server"
    echo "  - You can close this terminal - sync will continue"
    echo "  - Check progress with: curl http://localhost:3000/api/sync/progress | jq"
else
    echo "❌ Sync failed with status: $http_code"
    echo "$body" | jq . 2>/dev/null || echo "$body"
    exit 1
fi
