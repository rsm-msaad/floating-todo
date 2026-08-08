# Floating Checklist

A tiny always-on-top to-do list for macOS. It sits above your other windows and follows you to every Space and fullscreen app.

## Setup (one time)

1. Install Node.js if you don't have it: https://nodejs.org (grab the LTS build).
2. Clone or unzip this folder somewhere you'll keep it, like `~/Projects/floating-todo`.
3. Open the folder in VS Code, then open a terminal and run:

```bash
npm install
```

## Run it

```bash
npm start
```

## Using it

- Type in the input at the bottom and hit Enter to add a task.
- Click the circle to check it off. The text strikes through and dims.
- Hover a row and click the x to delete it.
- "Clear done" wipes all finished tasks at once.
- Drag the window by its top bar. x quits the app.

### Priority

Right-click any task row to set a priority (Urgent, Soon, Later) or clear it.
Prioritized rows show a colored left border and background tint.

### Detail window

Click a task row to open its detail window, where you can:

- Edit the title.
- Toggle done and set priority with pill buttons.
- Write freeform notes in an auto-growing text area.
- Attach files by clicking "+ Add files" or dragging them onto the window.
  Attachments are stored as paths, not copies. Click one to open it;
  right-click to reveal it in Finder.

All edits save automatically (debounced 300ms, plus on blur and close).
Press Escape to close the detail window.

### Edge tucking

Drag the window to the left or right edge of your screen and it tucks into a
slim tab. Click the tab to restore it.

### Persistence

Tasks are saved to a JSON file in your Electron userData directory (not
localStorage), written synchronously on every change so nothing is lost on
quit. Window position is also saved and restored.

## Notes

- There's no Dock icon on purpose, so it stays out of Cmd+Tab and feels like an overlay. Quit with the x in the top bar.
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
