# IRON DISTRICT — Free For All

Networked first-person shooter built in **Next.js**. One shared urban arena. Every client that opens the server address deploys into the same free-for-all instance.

Uses the repository models:

- `shooting_game_enviornment_map_tdm.glb` — arena
- `opponent.glb` — operator reference mesh (other players spawn as live nametagged operators)
- `fpv.glb` — first-person carbine with optic (from Gun-Models)

## Launch

Works on Windows PowerShell, macOS, and Linux (no Unix-only `NODE_ENV=` prefix).

```bash
npm install
npm run build
npm start
```

Development, bound to a LAN address:

```bash
npm install
npm run dev -- -H 192.168.18.15 -p 3000
```

Default bind is `0.0.0.0:3000` so other machines on the network can connect. Open `http://<host-ip>:3000`.

If Windows asks about Node.js firewall access, allow it on **private networks**.

## Play

1. Menu loads with **Settings** (graphics, sensitivity, controls, crosshair), **Credits**, and **Deploy**.
2. Deploy drops you into the single live arena.
3. Anyone else on the network who opens the same IP joins that arena.

| Action | Default |
| --- | --- |
| Move | WASD |
| Jump | Space |
| Sprint | Shift |
| Crouch | C |
| Fire | LMB |
| ADS | RMB |
| Reload | R |
| Gun align | ` |
| Scoreboard | Tab |
| Pause | Esc |

Weapon: FPV **optic carbine** (`fpv.glb` from Gun-Models / DJMaesen), **30-round mag with infinite reserve**. Hold ADS to look through the sight. **R** plays a mag-drop / seat / bolt reload. **` ** (backtick) opens live gun X/Y/Z alignment. Operators have 200 HP. Hitscan is the crosshair ray only — body or head, no near-miss cone. There are **no bots** — every Deploy joins this FFA. Other players use `opponent.glb`. An invisible circular wall keeps everyone inside the arena. Respawn picks a new ring point each time.

## Credits

- Map: **00amza** (Sketchfab) CC BY 4.0
- Operator / FN FAL: **Stavich** (Sketchfab) CC BY-NC-ND 4.0
