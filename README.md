# ElevenLabs Sheet Runner

Chrome extension for automating ElevenLabs text-to-speech generation from a Google Sheet.

## What It Does

- Reads text from Google Sheets column `H`
- Starts from any row, for example `H45`
- Supports replaying one row only, for example `H45`
- Opens or reuses your ElevenLabs tab
- Generates speech and downloads audio files named by row number like `1.mp3`, `45.mp3`
- Saves the last sheet URL, current row, last processed row, logs, and run state in `chrome.storage.local`

## Project Files

- `manifest.json` : Chrome extension manifest
- `popup.html` / `popup.css` / `popup.js` : extension popup UI
- `background.js` : batch flow, Google Sheets fetch, persistent state, download rename handling
- `content.js` : ElevenLabs page automation

## Install

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this folder: `d:\polymarket-bots\11labs_plugin`

## How To Use

1. Open the extension popup
2. Paste your Google Sheets URL
3. Click `Open ElevenLabs`
4. Make sure you are logged into ElevenLabs
5. Keep the ElevenLabs text-to-speech page open

### Batch Mode

1. Enter the row number in `Start From Row`
2. Click `Start Batch`
3. The extension will read `H[row]`, generate the audio, download it, then move to the next populated row

### Replay Mode

1. Enter the row number in `Replay Single Row`
2. Click `Replay Row`
3. The extension will generate only that one row and download it using the same row number

## Sheet Format

- The extension reads only column `H`
- `H1` maps to audio file `1.mp3`
- `H45` maps to audio file `45.mp3`
- Empty cells are skipped automatically in batch mode

## Persistence

The extension keeps these details even if the popup closes, the page refreshes, or Chrome restarts:

- sheet URL
- batch start row
- replay row
- running status
- current row
- last processed row
- recent activity logs

## Important Notes

- The Google Sheet must be accessible from the Chrome profile you are using
- The current implementation fetches the selected sheet tab using its `gid`
- The extension depends on ElevenLabs page controls such as the text area, `Generate speech`, and download button
- If ElevenLabs changes its UI, `content.js` may need selector updates

## Troubleshooting

- If the extension does nothing, reload it in `chrome://extensions`
- If the sheet does not load, confirm the Google Sheet URL is valid and accessible
- If generation works but download clicks fail, ElevenLabs may have changed the download button markup
- If file renaming does not happen, check Chrome download permissions and test again after reloading the extension
