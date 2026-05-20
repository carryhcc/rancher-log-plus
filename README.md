# Rancher Log Plus

<p align="right">
  <strong>English</strong> | <a href="./README.zh-CN.md">中文</a>
</p>

Rancher Log Plus is a local Chrome extension for improving the Rancher pod log viewer. It keeps Rancher's original log window available, then adds a richer log view with level coloring, filtering, search-like query syntax, export, clear, and scroll controls.

The extension runs entirely in your browser. It does not send logs, cookies, tokens, or page content to any remote server.

## Features

- Highlight `ERROR`, `WARN`, `INFO`, `DEBUG`, and `TRACE` log levels.
- Replace the native level dropdown with a custom dark dropdown that fits log-reading UI.
- Filter logs by keyword, multiple `and` terms, `not` exclusions, or JavaScript-style regex such as `/timeout|failed/i`.
- Keep Rancher's original raw log view as a fallback.
- Open a full-screen beautified log modal.
- Pause or resume auto-scroll.
- Clear logs by triggering Rancher's native `Clear Screen` action and clearing the extension cache.
- Export the current filtered logs to a local `.log` file.
- Close the beautified modal and Rancher's native log modal together.

## Supported Rancher Log Structure

Rancher Log Plus is optimized for the Rancher log modal structure used by Rancher 2.x:

- Log container: `pre.log-body.wrap-lines`
- Log row: `.log-msg.log-combined`
- Log timestamp: `.log-date`
- Native close button: a `button` with `data-ember-action-*` and text `Close` or `关闭`
- Native clear button: a `button` with `data-ember-action-*` and text `Clear Screen` or `清除屏幕`

The extension only activates when it detects a Rancher-style log container. Although the manifest can run on `http` and `https` pages, the code does not collect or transmit page data.

## Installation

1. Clone or download this repository.
2. Open Chrome and go to `chrome://extensions/`.
3. Enable `Developer mode`.
4. Click `Load unpacked`.
5. Select the repository folder.
6. Open a Rancher workload page and click `View Logs`.

## Usage

1. Open a Rancher pod log modal.
2. The extension adds a small `Log Style` bar near the original log window.
3. Click `Beautify Logs` to open the enhanced viewer.
4. Use the level dropdown to show all logs or only a specific level.
5. Use the filter box for keyword, `and`, `not`, or regex filtering.
6. Click `Clear Logs` to clear Rancher's screen and reset the extension cache.
7. Click `Download Logs` to export the currently filtered logs.
8. Click `Close` or press `Escape` to close the enhanced viewer and the Rancher log modal.

## Filter Examples

```text
timeout
timeout and user
timeout not healthcheck
/error|exception/i
```

## Troubleshooting

If the toolbar does not appear, open the Rancher page console and run:

```js
!!window.RLS
```

- `true`: the extension script is injected.
- `false`: reload the extension in `chrome://extensions/`, then refresh the Rancher page.

If the enhanced viewer opens but no logs appear, confirm that the Rancher modal contains `pre.log-body` and `.log-msg` elements.

## Privacy

Rancher Log Plus is a client-side content script. It does not make network requests, upload logs, read browser cookies, or store log content persistently. It only stores the selected log level and filter text in `localStorage` for convenience.

## Project Files

- `manifest.json`: Chrome extension manifest.
- `utils.js`: shared state, DOM detection, query parsing, and helper utilities.
- `parser.js`: Rancher log parsing and incremental log ingestion.
- `ui.js`: row rendering and the custom level dropdown.
- `content.js`: main extension lifecycle and Rancher integration.
- `content.css`: enhanced log viewer styling.
