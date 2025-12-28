# Voting Power Tracker

A Next.js application that tracks ERC20Votes delegation power for ARB token on Arbitrum network. The app displays historical voting power changes in a stacked timeline chart and shows current delegator balances.

## Features

- Track voting power delegation over time
- Visualize delegation changes with a stacked timeline chart
- View current delegators and their balances
- Automatic sync with Arbitrum blockchain using free RPC endpoints
- Data stored in Vercel Blob Storage

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure the app by editing `config.json`:
```json
{
  "delegateAddress": "0x...",  // Your target delegate address
  "tokenAddress": "0x912CE59144191C1204E64559FE8253a0e49E6548",  // ARB token
  "chainId": 42161  // Arbitrum One
}
```

3. Set up environment variables in Vercel:
   - `BLOB_READ_WRITE_TOKEN`: Get this from your Vercel dashboard under Blob Storage settings

## Development

Run the development server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Deployment

1. Push your code to GitHub
2. Import the project in Vercel
3. Add the `BLOB_READ_WRITE_TOKEN` environment variable
4. Deploy!

## Usage

1. First, sync the data by clicking the "Sync Data" button. This will fetch all historical delegation events from the blockchain.
2. The timeline chart will show voting power changes over time, with each delegator represented by a different color.
3. The delegators list shows current delegators and their balances.

## Technical Details

- Uses free Arbitrum RPC endpoints (no API keys required)
- Automatically falls back to multiple RPC endpoints if one fails
- Processes events in chunks to handle rate limits
- Stores processed data in Vercel Blob Storage for fast retrieval

## Architecture

- **Frontend**: Next.js with React and Recharts for visualization
- **Backend**: Next.js API routes
- **Blockchain**: Viem for Ethereum interactions
- **Storage**: Vercel Blob Storage
- **RPC**: Free Arbitrum public RPC endpoints

