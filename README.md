# Official CATAN Multiplayer Web Platform

A full-featured online multiplayer CATAN platform built with TypeScript, React 19, Socket.IO, and Tailwind CSS, supporting both the **Base Game** and the **Cities & Knights Expansion** (3–4 and 5–6 Players).

## Features
- **Base Game & 5–6 Player Expansion**:
  - **3–4 Players**: Standard 19-hex board, 9 harbors, and spiral number tokens with guaranteed no adjacent red `6`/`8` tokens and balanced harbor spacing.
  - **5–6 Players**: 30-hex board, 11 harbors, 28 number tokens, and the **Paired Players (Player 1 / Player 2) Turn system**.
- **Cities & Knights Expansion**:
  - **Commodities & City Improvements**: Cloth, Coin, and Paper production on Forest, Mountains, and Pasture cities; 5-level Trade, Politics, and Science improvement tracks with special abilities (Trading House, Fortress, and Aqueduct).
  - **Metropolises**: Claimable at Level 4 (`+2 VP`, immune to barbarian pillaging) and stealable when another player reaches Level 5 first.
  - **Knights & Barbarian Track**: Basic, Strong, and Mighty Knights (recruit, activate, promote, move, displace opponent knights, break opponent Longest Road, chase the robber), City Walls (`+2` hand limit per wall), and full Barbarian Attack resolution (Defender of Catan VPs, tie draws, and city pillaging).
  - **54 Progress Cards**: Complete Trade, Politics, and Science decks with official card artwork and interactive prompts (Alchemist, Crane, Engineer, Inventor, Irrigation, Medicine, Mining, Printer, Road Building, Smith, Commercial Harbor, Master Merchant, Merchant, Merchant Fleet, Resource Monopoly, Trade Monopoly, Bishop, Constitution, Deserter,omat, Intrigue, Saboteur, Spy, Warlord, Wedding).
- **Optional House Rules**:
  - **Balanced Dice Deck** (36-roll deck without replacement)
  - **Hidden Bank** (conceals bank card counts)
  - **Free Trades / Gifts** (allows one-sided trades)
  - **Friendly Robber** (cannot target players at or below starting VPs)
  - **No Early 7s** (auto-rerolls natural 7s during the first 2 rounds)
  - **2 & 12 Combined** (rolling 2 or 12 produces on both `2` and `12` hexes)
  - **Play Dev Card Same Turn Bought**
  - **Harbor Master** (`+2 VP` award for reaching 3+ Harbor Points on coastal ports)
- **Modern Trade Dock & Reconnection**:
  - Inline quick trade selector (Resources & Commodities), smart 1-click Maritime Exchange (`2:1`, `3:1`, `4:1`, Merchant `2:1`, Trading House `2:1`, and Merchant Fleet `2:1`), and interactive Counter-Offers.
  - Persistent Google OAuth / session token recovery and room state persistence in `data/rooms/`.

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

### 2. Public Tunneling (Optional)
```bash
pnpm tunnel:cloudflare   # Cloudflare Tunnel (https://inventorsofcatan.dpdns.org)
pnpm tunnel:ngrok        # Ngrok HTTP tunnel on port 5173
pnpm tunnel:tailscale    # Tailscale Funnel on port 5173
```

### 3. Production Build & Tests
```bash
pnpm build
pnpm test
pnpm start
```
