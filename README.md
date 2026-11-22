# Storm-Game

## Getting Started

### Prerequisites

- Roblox Studio with the Rojo plugin
- Node.js and npm
- Aftman

Install the project's pinned tools and JavaScript dependencies:

```bash
aftman install
npm install
```

Compile the TypeScript and start Rojo:

```bash
npm run build
rojo serve
```

Open the game in Roblox Studio and connect to the running Rojo server through the Rojo plugin. To create a place file instead, compile first and run:

```bash
rojo build -o "Storm-Game.rbxlx"
```

### Development

Run the TypeScript compiler after changes:

```bash
npm run build
```

For continuous compilation while editing:

```bash
npm run watch
```

The compiler writes Luau to `out`; `default.project.json` maps that output into Roblox services.

## Project layout

- `src/client/` contains the menu, character controls, abilities, charge UI, and character-specific animation configurations.
- `src/server/` contains character rig loading, loadouts, movement setup, and server-validated combat.
- `src/shared/` is for code shared between client and server.
- `assets/` and `config/` contain project resources and configuration.
- `aftman.toml` pins the Rojo tool version.

## Gameplay controls

Choose Rage, Flood, or Rain from the menu. Hold Shift to sprint. Double-tap Space while airborne to toggle flight; steer with WASD, ascend with Space, and descend with Left Ctrl. While flying, hold E to charge a dive and use the floor marker to aim. The charge bar shows progress and readiness; releasing E early cancels the charge. Click to attack with the selected character's weapon.

## Adding a playable character

Keep character registration and rig IDs consistent between the server character configuration, the flight controller, and the character-specific animation script. Add the character to the menu and server loadouts, then create its dedicated animation configuration using the shared animation controller. Keep asset IDs in source configuration rather than this guide.

For tool usage and project setup details, see the [Rojo documentation](https://rojo.space/docs/).
