# DAO Delegate Dashboard

A Next.js application that tracks ERC20Votes delegation power and voting history for DAO delegates. Supports multiple EVM chains and integrates with Snapshot.org and Tally.xyz for governance proposals.

## Features

- Track voting power delegation over time
- Visualize delegation changes with a stacked timeline chart
- View current delegators and their balances
- Track votes on Snapshot.org proposals
- Track votes on onchain governor proposals
- Multi-chain support (Arbitrum, Optimism, Base, Polygon, and more)
- Automatic sync with blockchain using free RPC endpoints
- Data stored locally in `data/` directory

## Quick Start for New Delegates

1. **Clone and install:**
```bash
git clone <repo-url>
cd paulofi
npm install
```

2. **Configure `config.json`:**
```json
{
  "_comment_endBlock": "endBlock: Specific block number, or use 'latest' to sync to current block",
  "_comment_tallyDaoName": "tallyDaoName: DAO slug used in Tally URLs (e.g., 'arbitrum' for tally.xyz/gov/arbitrum/...)",

  "delegateAddress": "0xYOUR_DELEGATE_ADDRESS",
  "tokenAddress": "0xTOKEN_CONTRACT_ADDRESS",
  "chainId": 42161,
  "chainName": "arbitrum",
  "l1ChainName": "mainnet",
  "startBlock": 248786699,
  "endBlock": "latest",
  "tallyDaoName": "arbitrum",
  "snapshotSpace": "arbitrumfoundation.eth",
  "governors": {
    "core": "0xCORE_GOVERNOR_ADDRESS",
    "treasury": "0xTREASURY_GOVERNOR_ADDRESS"
  }
}
```

3. **Set up environment variables** (create `.env.local`):
```bash
SYNC_SECRET=your_sync_secret
DRPC_RPC_URL=your_archive_rpc_url  # Optional, for historical data
```

4. **Run the development server:**
```bash
npm run dev
```

5. **Sync data** by calling the sync API endpoints:
```bash
# Sync delegation events
curl -X POST http://localhost:3000/api/sync

# Sync votes (Snapshot + on-chain)
curl -X POST http://localhost:3000/api/votes/sync
```

## Configuration Reference

| Field | Required | Description |
|-------|----------|-------------|
| `delegateAddress` | Yes | The delegate address to track |
| `tokenAddress` | Yes | The ERC20Votes token contract address |
| `chainId` | Yes | Chain ID (e.g., 42161 for Arbitrum) |
| `chainName` | Yes | Chain name for RPC client (see supported chains) |
| `l1ChainName` | No | L1 chain for timestamp conversions (e.g., "mainnet" for Arbitrum) |
| `startBlock` | Yes | Block number to start syncing from (token deployment) |
| `endBlock` | Yes | Specific block number or `"latest"` to sync to current block |
| `tallyDaoName` | No | DAO slug for Tally URLs (e.g., "arbitrum", "optimism", "uniswap") |
| `snapshotSpace` | No | Snapshot.org space ID (e.g., "arbitrumfoundation.eth") |
| `governors.core` | No | Core governor contract address |
| `governors.treasury` | No | Treasury governor contract address |

## Supported Chains

- `arbitrum` (42161)
- `mainnet` (1)
- `optimism` (10)
- `base` (8453)
- `polygon` (137)
- `avalanche` (43114)
- `bsc` (56)
- `gnosis` (100)

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SYNC_SECRET` | No | Secret for background sync API authentication |
| `DRPC_RPC_URL` | No | Custom RPC endpoint (falls back to free public RPCs) |
| `ARCHIVE_RPC_URL` | No | Archive node RPC for historical data |

## Deployment

1. Push your code to GitHub
2. Deploy to your preferred hosting platform (Vercel, Railway, etc.)
3. Set environment variables:
   - `SYNC_SECRET` (generate a random string)
   - `DRPC_RPC_URL` (optional, for better RPC performance)
4. Deploy!

**Note:** Data is stored in the `data/` directory. Make sure this directory is writable and persistent across deployments.

## Syncing Data

### Initial Sync
Run the sync endpoints to fetch all historical delegation events and votes:

```bash
# Sync delegation events (this may take a while for large block ranges)
curl -X POST http://localhost:3000/api/sync

# Sync votes from Snapshot and on-chain governors
curl -X POST http://localhost:3000/api/votes/sync
```

### Background Sync
For production, set up a cron job to call the sync endpoints:

```bash
# Sync delegation events
curl -X POST https://your-domain.com/api/sync/background \
  -H "X-Sync-Token: your_sync_secret"

# Sync votes
curl -X POST https://your-domain.com/api/votes/sync \
  -H "X-Sync-Token: your_sync_secret"
```

## Technical Details

- Uses free public RPC endpoints (no API keys required)
- Automatically falls back to multiple RPC endpoints if one fails
- Processes events in chunks to handle rate limits
- Stores processed data locally in `data/` directory

## Architecture

- **Frontend**: Next.js with React and Recharts for visualization
- **Backend**: Next.js API routes
- **Blockchain**: Viem for Ethereum interactions
- **Storage**: Local file storage (`data/` directory)
- **Governance**: Snapshot.org GraphQL API + On-chain governor events

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sync` | POST | Sync delegation events (interactive) |
| `/api/sync/background` | POST | Sync delegation events (background) |
| `/api/votes/sync` | POST | Sync votes from Snapshot and governors |
| `/api/cleanup` | POST | Truncate data after endBlock |
| `/api/timeline` | GET | Get delegation timeline data |
| `/api/votes` | GET | Get votes data |
| `/api/config` | GET | Get public config values |
