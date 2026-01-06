# Implementation Plan: Delegator Share Value Column

## Feature Overview
Add a new column to the delegators table showing the USD value each delegator is entitled to claim from a multisig funds wallet, based on their reward share percentage.

---

## 1. Configuration Changes

### File: `config.json`

Add new configuration entries:

```json
{
  // ... existing config ...
  "fundsWallet": {
    "address": "0x76E8Dd748c91D6b1Ac2feEB3cef40Db04aCF0eca",
    "chainPrefix": "arb1",
    "chainId": 42161
  },
  "fundsWalletTokens": [
    {
      "address": "0x912CE59144191C1204E64559FE8253a0e49E6548",
      "symbol": "ARB",
      "decimals": 18,
      "coingeckoId": "arbitrum"
    },
    {
      "address": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      "symbol": "USDC",
      "decimals": 6,
      "coingeckoId": "usd-coin"
    }
  ]
}
```

### File: `lib/config.ts`

Update the config loader to include new fields:
- Add `FundsWalletConfig` interface
- Add `FundsWalletToken` interface
- Update `AppConfig` interface
- Add validation for new fields

---

## 2. New Library Files

### File: `lib/fundsWallet.ts`

Create a new module to handle funds wallet operations:

```typescript
// Types
interface TokenBalance {
  address: string;
  symbol: string;
  balance: bigint;
  decimals: number;
  formattedBalance: string;
}

interface TokenPrice {
  symbol: string;
  usdPrice: number;
}

interface FundsWalletData {
  tokens: Array<{
    symbol: string;
    balance: string;        // formatted (e.g., "2000")
    balanceRaw: string;     // wei as string
    usdPrice: number;
    usdValue: number;
  }>;
  totalUsdValue: number;
  lastUpdated: number;      // timestamp
}

// Functions to implement:

1. fetchTokenBalances(walletAddress, tokens, chainId)
   - Uses Viem to call balanceOf() for each ERC20 token
   - Returns array of TokenBalance objects

2. fetchTokenPrices(coingeckoIds)
   - Calls CoinGecko API: GET /simple/price?ids=arbitrum,usd-coin&vs_currencies=usd
   - Returns map of coingeckoId -> usdPrice
   - Includes error handling and fallback (USDC = $1.00)

3. calculateFundsWalletData(config)
   - Combines balance + price data
   - Calculates total USD value
   - Returns FundsWalletData object
```

### File: `lib/types.ts`

Add new interfaces:

```typescript
// Funds wallet types
interface FundsWalletTokenConfig {
  address: string;
  symbol: string;
  decimals: number;
  coingeckoId: string;
}

interface FundsWalletConfig {
  address: string;
  chainPrefix: string;
  chainId: number;
}

interface FundsWalletTokenData {
  symbol: string;
  balance: string;
  balanceRaw: string;
  usdPrice: number;
  usdValue: number;
}

interface FundsWalletData {
  tokens: FundsWalletTokenData[];
  totalUsdValue: number;
  lastUpdated: number;
}

// Delegator share value
interface DelegatorShareValue {
  totalUsdValue: number;
  tokenBreakdown: Array<{
    symbol: string;
    amount: string;
  }>;
}
```

---

## 3. New API Endpoint

### File: `app/api/funds-wallet/route.ts`

Create new API endpoint to fetch funds wallet data:

```typescript
// GET /api/funds-wallet
// Returns: FundsWalletData

// Implementation:
1. Load config
2. Call fetchTokenBalances() for all configured tokens
3. Call fetchTokenPrices() for all token coingeckoIds
4. Combine into FundsWalletData response
5. Cache result for 60 seconds to avoid rate limiting
```

**Response format:**
```json
{
  "tokens": [
    {
      "symbol": "ARB",
      "balance": "50000",
      "balanceRaw": "50000000000000000000000",
      "usdPrice": 0.85,
      "usdValue": 42500
    },
    {
      "symbol": "USDC",
      "balance": "25000",
      "balanceRaw": "25000000000",
      "usdPrice": 1.00,
      "usdValue": 25000
    }
  ],
  "totalUsdValue": 67500,
  "lastUpdated": 1704505200000
}
```

---

## 4. Frontend Changes

### File: `app/page.tsx`

Add data fetching for funds wallet:

```typescript
// In fetchAllData() or equivalent:
const fundsWalletRes = await fetch('/api/funds-wallet');
const fundsWalletData = await fundsWalletRes.json();

// Pass to DelegatorsList component:
<DelegatorsList
  // ... existing props
  fundsWalletData={fundsWalletData}
/>
```

### File: `app/components/DelegatorsList.tsx`

#### Props Update:
```typescript
interface DelegatorsListProps {
  // ... existing props
  fundsWalletData?: FundsWalletData;
}
```

#### New Column Logic:

```typescript
// Calculate share value for each delegator
function calculateShareValue(
  rewardPercentage: number,
  fundsWalletData: FundsWalletData
): DelegatorShareValue {
  const shareRatio = rewardPercentage / 100;

  return {
    totalUsdValue: fundsWalletData.totalUsdValue * shareRatio,
    tokenBreakdown: fundsWalletData.tokens.map(token => ({
      symbol: token.symbol,
      amount: (parseFloat(token.balance) * shareRatio).toFixed(
        token.symbol === 'USDC' ? 2 : 2
      )
    }))
  };
}
```

#### Table Header:
Add 4th column header: "Share Value"

#### Table Cell Rendering:
```tsx
{/* Share Value Column */}
<td className="px-4 py-3 text-right">
  {fundsWalletData && delegator.rewardPercentage > 0 ? (
    <div>
      <div className="font-semibold text-green-600">
        ${shareValue.totalUsdValue.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })} USD
      </div>
      <div className="text-xs text-gray-500">
        {shareValue.tokenBreakdown
          .map(t => `${parseFloat(t.amount).toLocaleString()} ${t.symbol}`)
          .join(' + ')}
      </div>
    </div>
  ) : (
    <span className="text-gray-400">-</span>
  )}
</td>
```

#### CSV Export Update:
Add `share_value_usd` column to CSV export.

---

## 5. Implementation Order

### Step 1: Configuration (lib/config.ts, config.json)
- Add new config interfaces
- Add validation
- Update config.json with actual values

### Step 2: Types (lib/types.ts)
- Add all new TypeScript interfaces

### Step 3: Funds Wallet Library (lib/fundsWallet.ts)
- Implement token balance fetching
- Implement price fetching from CoinGecko
- Implement data aggregation function

### Step 4: API Endpoint (app/api/funds-wallet/route.ts)
- Create the endpoint
- Add caching
- Add error handling

### Step 5: Frontend Integration (app/page.tsx)
- Add data fetching
- Pass data to component

### Step 6: Table UI (app/components/DelegatorsList.tsx)
- Add new column
- Implement share value calculation
- Update CSV export

---

## 6. Technical Considerations

### CoinGecko API
- Free tier: 10-30 calls/minute
- Cache prices for 60 seconds minimum
- Fallback: Assume USDC = $1.00 if API fails

### RPC Calls
- Use existing Viem client setup
- balanceOf() calls are cheap (view functions)
- Can batch multiple balanceOf calls using multicall

### Error Handling
- If funds wallet fetch fails, show column but with "Loading..." or error state
- If price fetch fails, show token amounts without USD conversion

### Performance
- Funds wallet data should be fetched once per page load
- Consider adding refresh button or auto-refresh every 5 minutes
- Cache API response on server side

---

## 7. File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `config.json` | Modify | Add fundsWallet and fundsWalletTokens |
| `lib/config.ts` | Modify | Add new interfaces and validation |
| `lib/types.ts` | Modify | Add FundsWallet-related types |
| `lib/fundsWallet.ts` | Create | Token balance/price fetching logic |
| `app/api/funds-wallet/route.ts` | Create | New API endpoint |
| `app/page.tsx` | Modify | Fetch funds wallet data |
| `app/components/DelegatorsList.tsx` | Modify | Add Share Value column |

---

## 8. Example Output

For a delegator with 10% reward share and a funds wallet containing:
- 50,000 ARB @ $0.85 = $42,500
- 25,000 USDC @ $1.00 = $25,000
- Total: $67,500

The delegator's share value column would show:
```
$6,750.00 USD
5,000 ARB + 2,500 USDC
```
