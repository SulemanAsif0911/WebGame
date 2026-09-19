# IRON DISTRICT — Free For All

Networked first-person shooter built in **Next.js**. One shared urban arena. Every client that opens the server address deploys into the same free-for-all instance.

Uses the repository models:

- `shooting_game_enviornment_map_tdm.glb` — arena
- `opponent.glb` — operator + FN FAL (first-person camera bone for local player, full body for everyone else)

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
| Scoreboard | Tab |
| Pause | Esc |

Weapon: FN FAL, 20-round magazine, hitscan 7.62, headshots are lethal.

## Credits

- Map: **00amza** (Sketchfab) CC BY 4.0
- Operator / FN FAL: **Stavich** (Sketchfab) CC BY-NC-ND 4.0
