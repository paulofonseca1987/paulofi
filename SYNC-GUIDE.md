# Background Sync Guide

This guide explains how to run the voting power sync in the background without keeping your browser tab open.

## Overview

The sync now runs completely in the background on the Next.js server. You can:
- ✅ Start sync and close your terminal
- ✅ Monitor progress by refreshing the web page
- ✅ Check progress from command line anytime
- ✅ Close browser tabs - sync continues running

## Prerequisites

Make sure the Next.js dev server is running:
```bash
npm run dev
```

## Quick Start

### 1. Start Background Sync

```bash
./sync-background.sh
```

This will:
- Trigger the background sync endpoint
- Start syncing from block 250,000,000 to current
- Run independently of your browser
- Continue even if you close the terminal

### 2. Check Progress

**Option A: Web Browser**
- Open http://localhost:3000
- The progress bar updates automatically
- Refresh the page to see latest progress

**Option B: Command Line**
```bash
./check-progress.sh
```

This shows:
- Current block being synced
- Target block
- Progress percentage
- Estimated time remaining
- Events processed

### 3. Monitor in Real-Time

Watch progress update every 2 seconds:
```bash
watch -n 2 ./check-progress.sh
```

Press `Ctrl+C` to stop watching (sync continues in background).

## How It Works

1. **Background Sync Endpoint**: Uses `/api/sync/background` which requires authentication
2. **Progress Tracking**: Stores progress in `data/data-sync-progress.json`
3. **Independent Execution**: Runs in the Next.js server process
4. **Browser Independent**: No need to keep browser tabs open

## What Gets Tracked

With the new balance tracking feature, the sync captures:

- ✅ **Delegation changes** (DelegateChanged events)
- ✅ **Balance changes** (DelegateVotesChanged events)
- ✅ **Complete voting power history** for all delegators
- ✅ **Every ARB token transfer** by delegators

 ## Performance Notes

- **Speed**: Processes roughly 10,000 blocks per request
- **Time**: A full sync typically takes 2-3 hours (~167M blocks)
- **Approach**: Attempts to capture all voting power changes by scanning event logs
- **Storage**: Timeline entries are saved approximately every 1M blocks

## Troubleshooting

### Sync won't start
```bash
# Check if sync is already running
./check-progress.sh

# If stuck, remove lock file
rm -f data/data-sync-lock.json data/data-sync-progress.json

# Then try again
./sync-background.sh
```

### Server not responding
```bash
# Make sure dev server is running
npm run dev

# Check server is accessible
curl http://localhost:3000/api/sync/progress
```

### View server logs
```bash
# Logs are in the npm run dev terminal
# Look for "Fetching events from block..." messages
```

## API Endpoints

For manual control:

```bash
# Check progress
curl http://localhost:3000/api/sync/progress | jq

# Start background sync (requires secret)
curl -X POST http://localhost:3000/api/sync/background \
  -H "X-Sync-Token: dev-secret-123" \
  -H "Content-Type: application/json"

# View current data
curl http://localhost:3000/api/data | jq
```

## Tips

- 💡 Let the sync run overnight for best results
- 💡 The sync saves progress every 1M blocks, so it's safe to stop
- 💡 You can close your laptop lid - sync continues on the server
- 💡 Timeline entries are partitioned (1000 per file) for performance
- 💡 First sync takes longest; future syncs are incremental

## Next Steps

After sync completes:
1. Visit http://localhost:3000 to view the dashboard
2. See voting power timeline chart
3. Browse delegator list with current balances
4. All data stored in `data/` directory
