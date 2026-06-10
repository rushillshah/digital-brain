# Desktop Preview

Digital Brain includes an Electron desktop preview for macOS-style local setup and control.

Run it from the repo:

```bash
npm install
npm run desktop
```

The desktop app wraps the existing CLI engine. It can:

- choose or create a vault
- run guided setup
- show source/integration cards
- run `digital-brain run`
- run `digital-brain doctor`
- open the vault folder
- open the vault in Obsidian
- stream local command output

## Why Electron First

Electron is the fastest way to validate the desktop UX because the project already uses Node and CLI scripts. A later signed Mac app can move to Tauri or native Swift if size, notarization, and deeper macOS integrations become more important.

## Packaging Later

This is not yet a signed `.app` release. Before public desktop distribution:

- add packaging and signing
- add permission education screens for local app databases
- add a safer background daemon model
- add source-specific setup diagnostics
- add an approval queue for outbound messaging
- keep the CLI as the engine so terminal and desktop behavior stay consistent
