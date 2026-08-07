# Floating Checklist

A tiny always-on-top to do list for macOS. It sits above your other windows and follows you to every Space and fullscreen app.

## Setup (one time)

1. Install Node.js if you don't have it: https://nodejs.org (grab the LTS build).
2. Unzip this folder somewhere you'll keep it, like `~/Projects/floating-todo`.
3. Open the folder in VS Code, then open a terminal (Terminal menu, New Terminal) and run:

```bash
npm install
```

## Run it

```bash
npm start
```

## Using it

- Type in the box and hit Enter to add a task.
- Click the circle to check it off. The text strikes through and dims.
- Hover a row and click the × to delete it.
- "Clear done" wipes all finished tasks at once.
- Drag the window by its top bar.
- Chevron collapses it to a slim strip. × quits the app.

Tasks and window position are saved automatically, so it comes back exactly as you left it.

## Notes

- There's no Dock icon on purpose, so it stays out of Cmd+Tab and feels like an overlay. Quit with the × in the top bar.
- Resize by dragging any edge.

## Build the app

To package Checklist as a standalone macOS `.app`:

```bash
npm run build
```

This uses `@electron/packager` (already in devDependencies) to produce:

```
dist/Checklist-darwin-arm64/Checklist.app
```

The app has `LSUIElement` set, so it stays out of the Dock and Cmd+Tab — same
as running from the terminal.

**First launch:** macOS quarantines unsigned apps. Clear the flag so it opens
without the "unidentified developer" warning:

```bash
xattr -cr dist/Checklist-darwin-arm64/Checklist.app
```

Then double-click `Checklist.app` in Finder, or drag it to `/Applications`
and add it to Login Items so it starts automatically.
