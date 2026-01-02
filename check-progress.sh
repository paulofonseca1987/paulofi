#!/bin/bash

# Check sync progress script
# Displays current sync status in a readable format

echo "📊 Checking sync progress..."
echo ""

progress=$(curl -s http://localhost:3000/api/sync/progress)

if [ $? -ne 0 ]; then
    echo "❌ Error: Could not connect to server"
    echo "💡 Make sure the dev server is running: npm run dev"
    exit 1
fi

isActive=$(echo "$progress" | jq -r '.isActive')

if [ "$isActive" = "true" ]; then
    echo "✅ Sync is ACTIVE"
    echo ""

    currentBlock=$(echo "$progress" | jq -r '.currentBlock')
    targetBlock=$(echo "$progress" | jq -r '.targetBlock')
    startBlock=$(echo "$progress" | jq -r '.startBlock')
    eventsProcessed=$(echo "$progress" | jq -r '.eventsProcessed')
    percentComplete=$(echo "$progress" | jq -r '.percentComplete')
    estimatedTimeRemaining=$(echo "$progress" | jq -r '.estimatedTimeRemaining')

    # Format numbers with commas
    currentBlock_fmt=$(printf "%'d" $currentBlock)
    targetBlock_fmt=$(printf "%'d" $targetBlock)
    startBlock_fmt=$(printf "%'d" $startBlock)
    eventsProcessed_fmt=$(printf "%'d" $eventsProcessed)

    # Calculate percentage with 2 decimals
    percent=$(printf "%.2f" $(echo "$percentComplete" | bc))

    # Convert milliseconds to human readable time
    if [ "$estimatedTimeRemaining" != "null" ] && [ "$estimatedTimeRemaining" != "0" ]; then
        hours=$(echo "$estimatedTimeRemaining / 1000 / 3600" | bc)
        minutes=$(echo "($estimatedTimeRemaining / 1000 % 3600) / 60" | bc)
        timeRemaining="${hours}h ${minutes}m"
    else
        timeRemaining="Calculating..."
    fi

    echo "📍 Current block:     $currentBlock_fmt"
    echo "🎯 Target block:      $targetBlock_fmt"
    echo "🔢 Events processed:  $eventsProcessed_fmt"
    echo "📈 Progress:          ${percent}%"
    echo "⏱️  Time remaining:    $timeRemaining"
    echo ""
    echo "💡 Refresh http://localhost:3000 to see live updates"
else
    echo "⏸️  Sync is NOT active"
    echo ""

    # Check if we have any data
    metadata=$(curl -s http://localhost:3000/api/data 2>/dev/null)

    if echo "$metadata" | jq -e '.lastSyncedBlock' > /dev/null 2>&1; then
        lastSynced=$(echo "$metadata" | jq -r '.lastSyncedBlock')
        totalDelegators=$(echo "$metadata" | jq -r '.totalDelegators')
        totalTimelineEntries=$(echo "$metadata" | jq -r '.totalTimelineEntries')

        lastSynced_fmt=$(printf "%'d" $lastSynced)
        totalDelegators_fmt=$(printf "%'d" $totalDelegators)
        totalTimelineEntries_fmt=$(printf "%'d" $totalTimelineEntries)

        echo "📊 Last sync data:"
        echo "   Block: $lastSynced_fmt"
        echo "   Delegators: $totalDelegators_fmt"
        echo "   Timeline entries: $totalTimelineEntries_fmt"
        echo ""
        echo "💡 Run ./sync-background.sh to start syncing"
    else
        echo "📭 No sync data found"
        echo ""
        echo "💡 Run ./sync-background.sh to start your first sync"
    fi
fi
