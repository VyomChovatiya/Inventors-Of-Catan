# Official 2025 CATAN Multiplayer Web Platform

A responsive, bug-free, full-featured online multiplayer CATAN platform built with TypeScript, React 19, Socket.IO, and Tailwind CSS, adhering strictly to the **official 2025 6th Edition Rulebooks**.

## Features Implemented in Phase 1
- **Official 2025 6th Edition Rules & Layouts**:
  - **Base Game (3–4 Players)**: Standard 19-hex board, 9 harbors, official spiral number tokens A–R (skipping desert), with guaranteed no adjacent red 6 and 8 numbers.
  - **5–6 Player Expansion**: 30-hex board, 11 harbors, official 28 number tokens, and the brand-new **Paired Players (Player 1 / Player 2) Turn system** from the 2025 rulebook (Player 2 takes a bank-trade/build/dev-card action phase 3 seats to the left of Player 1).
- **Core State Engine & Graph Math**:
  - Cube coordinate system `(q, r, s)` with deterministic vertex and edge resolution.
  - Snake draft initial placement (Round 1: 1..N, Round 2: N..1 with immediate resource payouts).
  - Distance rule enforcement (at least 2 road edges away from any existing settlement/city).
  - Continuous Longest Route calculation with **opponent settlement interruption** detection.
  - Development Cards (Knights, Road Building, Year of Plenty, Monopoly, Victory Points).
  - Robber placement, 7-roll discard limit resolution, and 1-card stealing.
- **Modern Counter-Offer Trade Dock**:
  - PlaySettlr-style inline quick trade selector (I Give / I Want).
  - Smart 1-click Maritime Exchange calculating your best harbor rate (`2:1`, `3:1`, or `4:1`).
  - Real-time opponent status badges (`Thinking...`, `Accepted`, `Declined`, `Countered`).
  - Interactive **Counter-Offer Drawer**: opponents can modify requested/offered cards; active player can accept counter-offers in one click.
- **Reconnection & Session Recovery**:
  - Cryptographic `sessionToken` stored in `localStorage` + URL room code (`/?room=ABCD`).
  - Disconnected players can reload or rejoin at any time without losing their hand or position.
  - Active matches survive server restarts through state persistence in `data/rooms/`.
- **Authentic Visual Presentation**:
  - Official flat-top terrain artwork extracted directly from your hex assets.
  - Official 2025 card artwork, robber figurine, and bonus tiles cropped from the rulebooks.
  - Crisp SVG pieces (settlements, cities, roads) rendered in all 6 player colors.

## Running the Project

### 1. Development Mode (Hot Reloading)
```bash
# Start both server and client in parallel:
pnpm dev

# Or start individually:
pnpm dev:server   # Starts backend on http://localhost:3001
pnpm dev:client   # Starts Vite frontend on http://localhost:5173
```

Open `http://localhost:5173` in your browser.

### 2. Multi-Player Local Testing
- Open `http://localhost:5173` in one tab and click **Create New Game**.
- Copy the room code (or click "Copy Invite Link").
- Open another browser window (or Incognito tab) to `http://localhost:5173/?room=CODE` to join as Player 2 and Player 3.
- Once 3 or more players have joined, the host clicks **Start Game**.

### 3. Production Build
```bash
pnpm build
pnpm start
```
Runs the full unified server and static frontend on `http://localhost:3001`.
