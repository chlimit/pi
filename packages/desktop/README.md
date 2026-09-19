# Pi Desktop

Development-only Windows and macOS desktop MVP for Pi. It uses Electron for the application shell and runs the Pi SDK in a separate Node.js process.

## Prerequisites

- Node.js 22.19 or newer
- At least one Pi provider configured through the existing `pi` CLI `/login` flow

## Run

From the repository root:

```bash
./pi-desktop.sh
```

```powershell
./pi-desktop.ps1
```

```bash
npm run desktop
```

The start script installs workspace dependencies when `node_modules` is missing, downloads the Electron binary when it is missing, builds the desktop package, and launches the app. Electron's binary download is an install lifecycle script. Review it before the first launch, or pass `--rebuild-electron` to download again.

```bash
./pi-desktop.sh --help
./pi-desktop.sh --install
./pi-desktop.sh --rebuild-electron
```

The app currently supports selecting a workspace, listing and resuming sessions, remembering the last workspace and session across restarts, streaming messages, tool status, stopping a run, model selection, thinking-level selection, and starting a new session. Opening a workspace continues the most recent session when one exists.

## Security

The renderer has Node.js integration disabled, context isolation enabled, and a narrow preload API. The Agent Host still runs with the current user's operating-system permissions. Tool approvals and workspace path restrictions are required before treating this as a production desktop client.
