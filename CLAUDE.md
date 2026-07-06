# CLAUDE.md — txhighway

> One-line description: TX Highway — a live visualization of Bitcoin and Ethereum
> traffic. Every vehicle on the two neon roads is a real transaction, streamed from
> public mempools over WebSockets. No simulation, no replay, no API keys.

## Tech Stack
- Static HTML/CSS/JS, no build step, no dependencies at runtime. Google Fonts
  (Space Grotesk, IBM Plex Mono).
- Canvas 2D engine with pre-rendered sprites (no image assets — everything is drawn
  programmatically at boot).
- Hosting: Render Static Site (publish path `.`), auto-deploys from `main`.

## Architecture
- Global `TXH` namespace, one module per file, loaded in order in `index.html`:
  `config → util → feed-prices → feed-btc → feed-eth → vehicles → highway → hud →
  historical → app`.
  `app.js` must load last; every module init is wrapped in try/catch so one dead feed
  never blanks the page.
- `historical.js` is the rewind/replay mode: resolves the real BTC block
  (mempool.space block-by-timestamp) and ETH block (binary search over PublicNode
  HTTPS RPC) for a chosen moment, replays their transactions sized at that day's
  CoinGecko prices, and suppresses live spawns while active (`TXH.historical.isActive()`).
- Live data sources (all free, keyless — do not add keyed providers):
  - `wss://ws.blockchain.info/inv` — unconfirmed BTC txs (full objects, satoshis)
  - `wss://mempool.space/api/v1/ws` — BTC blocks / mempool stats / fees
  - `wss://ethereum-rpc.publicnode.com` (fallback `wss://eth.drpc.org`) — ETH
    `newPendingTransactions` + `newHeads`; pending hashes are enriched with batched
    `eth_getTransactionByHash` calls (12 per 700ms — keeps up with ~13 tx/s mainnet)
  - Coinbase spot REST (CoinGecko fallback) — USD prices; vehicles are classed by USD
- All sockets run through `TXH.util.Feed`: auto-reconnect with backoff, endpoint
  rotation, silence watchdog. Maintain this pattern for any new feed.

## Commands
- Install: none (no dependencies)
- Run locally: `npx serve .` (WebSockets need an http origin; file:// mostly works too)
- Test: none — verification is visual (see Workflow)
- Lint/syntax: `for f in assets/js/*.js; do node --check "$f"; done`
- Build: none (static site)

## Workflow
- **Solo project.** Single developer (realvivek). No reviewers.
- **Push directly to `main`.** No pull request required.
- Keep `main` deployable at all times — every push to `main` auto-deploys to Render.
- **YOU MUST verify before pushing:** every `assets/js/*.js` passes `node --check`,
  and the page renders with live vehicles at desktop and 375px-wide viewports.
  Do not push on a red check.

## Commit Messages
- Use **Conventional Commits**: `type(scope): summary`
- Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `build`, `ci`
- Example: `feat(engine): add whale glow pulse`
- **IMPORTANT: Never mention Claude, AI, or assistant tooling** in commit messages,
  co-author trailers, code comments, PRs, or docs. No session links. Ever.

## Secrets — Never Commit
- **IMPORTANT: Never commit API keys, tokens, or credentials.** (This project needs
  none at runtime — keep it that way.)
- **Never commit `.env` files** (any `.env.*`). `.env` MUST be in `.gitignore`.
- Deployment credentials (e.g. the Render API key) live only in GitHub Actions
  secrets / the Render dashboard, never in code.
- If a secret is ever committed, treat it as compromised and rotate it immediately.

## Deployment (Render)
- One repo = one Render service. Push to `main` → Render auto-deploys (no manual step).
- After a deploy, confirm status via the Render API before calling it live.
- `render.yaml` at the root is the service blueprint (static site, publish path `.`).

## Design Rules
- **Classic cartoon daytime look, only.** Green fields, gray asphalt, flat white UI
  cards with chunky borders and hard offset shadows. The owner explicitly rejected a
  dark neon/glassmorphism theme — do not reintroduce it (no backdrop-filter, no glow
  gradients, no dark surfaces).
- All vehicle/prop art comes from `assets/sprites/classic-sheet.png` via the atlas in
  `vehicles-classic.js` (machine-extracted boxes). New art belongs on the sheet, not
  in path-drawing code.
- Chain identity: BTC `#f7931a` / ETH `#5b76f7` for stripes and borders; use the
  darker `accentInk` values from `config.js` for any colored TEXT on white. Identity
  is never color-alone — each chain owns a separately labeled road.
- Vehicle size encodes USD value (see `TXH.config.classes`); the golden ring marks a
  $1M+ whale. Color never encodes value.
- Status states (LIVE / RECONNECTING) always ship dot + text label, never dot alone.
- Every new CSS block needs the 900/768/600/480/380px breakpoints checked; usable at
  375px viewport width is a hard requirement.

## Verification Checklist (before any push)
1. `node --check` green on all JS files
2. Open the page: vehicles flowing on both roads within ~5s, HUD stats populating
3. Kill one endpoint in devtools (offline it) — the other road must keep moving
4. Click a vehicle — card shows value/fee and explorer link works
5. 375px viewport — shoulders, prices, and controls all visible and tappable
