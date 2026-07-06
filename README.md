# TX Highway

Live Bitcoin & Ethereum traffic as two cartoon highways through green fields — an
homage to the classic TX Highway. **Every vehicle is a real transaction happening
right now** — Bitcoin vehicles enter the moment a transaction hits the public
mempool, Ethereum vehicles as pending transactions propagate across the network.
Vehicle size tracks the USD value moved: hatchbacks carry pocket change, semi trucks
carry six figures, and a golden-ringed rig is a $1M+ whale. When a block is mined,
the toll gantry at the end of the road flashes green and confetti flies.

All vehicle and roadside art comes from a single owner-contributed sprite sheet
(`assets/sprites/classic-sheet.png`), machine-mapped into an atlas at build time of
the art — the app itself has no build step.

**Live:** https://txhighway.onrender.com

## How it works

Static site, no build step, no backend, no API keys. The browser connects straight to
free public data feeds:

| Feed | Source | Used for |
|------|--------|----------|
| `wss://ws.blockchain.info/inv` | blockchain.com | live unconfirmed BTC transactions |
| `wss://mempool.space/api/v1/ws` | mempool.space | BTC blocks, mempool size, fee rates |
| `wss://ethereum-rpc.publicnode.com` | PublicNode (dRPC fallback) | ETH pending txs + new heads |
| Coinbase spot REST | Coinbase (CoinGecko fallback) | USD prices |

Ethereum pending hashes arrive ~13/s; they're enriched with batched
`eth_getTransactionByHash` calls over the same socket so every vehicle carries its
true value and gas price. All sockets auto-reconnect with backoff and rotate to
fallback endpoints.

The renderer is a single Canvas 2D loop: vehicles are drawn once to offscreen sprite
canvases (per chain × class × hue variant) and blitted each frame, so a few hundred
concurrent transactions render at 60fps.

## Run locally

```
npx serve .
```

or just open `index.html`.

## Controls

- **click a vehicle** — transaction details + explorer link (a dashed ring marks the selected vehicle)
- **space / ⏸** — pause · **slider** — playback speed 0.25×–3×
- **rewind** — pick any past date + time: the app finds the actual BTC and ETH
  blocks mined at that moment (mempool.space block-by-timestamp + a binary
  search over PublicNode's RPC) and replays their real transactions, sized at
  that day's prices (CoinGecko history). Clearly labeled REPLAY; one click back to live.
- **legend** — always visible: the rate board under the highway shows the whole
  fleet with USD ranges

## Telemetry gantries

Each road reads from an overhead LED message board: block height, a live
"last block" clock (Bitcoin's ~10-minute heartbeat vs Ethereum's 12-second
pulse), fees, mempool depth, session totals, the network's 24h transaction
count (real for BTC via blockchain.com charts; estimated for ETH from sampled
blocks), and a 60-second throughput sparkline. A rotating news ticker calls
out rush hour (fees vs an hour ago), congestion, and — on the Ethereum board —
how fast the Base L2 side road is running compared to the L1 highway. A $1M+
whale entering the road flashes the gantry gold, and every mined block opens
the toll gate with a brief traffic surge. Transactions under $1K carpool into
badged vans so the road stays readable at 30+ tx/s.
