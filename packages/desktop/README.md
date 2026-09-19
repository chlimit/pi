# Pi Desktop

Development-only Windows and macOS desktop MVP for Pi. It uses Electron for the application shell and runs the Pi SDK in a separate Node.js process.

## Prerequisites

- Node.js 22.19 or newer
- At least one Pi provider configured through the existing `pi` CLI `/login` flow

## Run

From the repository root:

```powershell
npm install --ignore-scripts
npm rebuild electron
npm run desktop:dev
```

Electron's binary download is an install lifecycle script. Review it before running `npm rebuild electron`.

The app currently supports selecting a workspace, listing and resuming sessions, remembering the last workspace and session across restarts, streaming messages, tool status, stopping a run, model selection, thinking-level selection, and starting a new session. Opening a workspace continues the most recent session when one exists.

## Security

The renderer has Node.js integration disabled, context isolation enabled, and a narrow preload API. The Agent Host still runs with the current user's operating-system permissions. Tool approvals and workspace path restrictions are required before treating this as a production desktop client.
