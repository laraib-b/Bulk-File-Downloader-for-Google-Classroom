# Bulk File Downloader for Google Classroom

Download multiple Google Drive and Google Docs attachments from a single Google Classroom class in one batch.

## Installation

1. Download or clone this repository
2. Open Google Chrome and go to `chrome://extensions/`
   - Or use Menu → More Tools → Extensions
3. Turn on **Developer mode** (top-right)
4. Click **Load unpacked**
5. Select the folder that contains `manifest.json`

The extension should appear as **Bulk File Downloader for Google Classroom** in your extensions list and toolbar.

## Usage

1. Open [Google Classroom](https://classroom.google.com)
2. Enable the panel from the extension popup (toggle **Show download panel**)
3. Open a class that has file attachments

A floating panel appears in the top-right corner.

### Collecting files from one class

- Click through tabs and sections in the class (Stream, Classwork, etc.)
- Each time you open a section, the extension scans for attachments and **adds** them to the panel
- Files from different tabs in the **same class** accumulate in the list
- Use **Scan Files** to manually rescan the current view
- Use **Refresh file list** in the extension popup for the same effect

### Switching classes

- When you navigate to a **different class**, the panel clears and starts fresh for that class only
- Files from other classes do not appear in the panel

### Downloading

1. Check the files you want (or use **Select All**)
2. Click **Download Selected**
3. Files download one at a time to your default downloads folder (300ms delay between files to reduce throttling)

You can download the same file again later — previously downloaded files are not hidden from the panel.

## What files are detected

The extension detects attachments linked to:

- `drive.google.com`
- `docs.google.com`
- `drive/userdata`

It does **not** detect YouTube links, Google Forms, external websites, or plain hyperlinks in post text.

You must visit each tab/section where files live so they load into the page before they can be scanned.

## After reloading the extension

If you reload the extension in `chrome://extensions/`, **refresh any open Classroom tabs** before using it again. Otherwise you may see a connection error until the page is refreshed.

## Project Structure

```
├── manifest.json          # Extension manifest (Manifest V3)
├── background.js          # Service worker for downloads
├── content.js             # Content script (read-only DOM access)
├── content.css            # Styles for floating panel
├── popup.html             # Extension popup UI
├── popup.js               # Popup script
├── jszip.min.js           # JSZip library (legacy ZIP support in background)
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## Technical Details

- **Manifest Version**: 3
- **Content script**: Reads Classroom DOM (read-only), detects attachments, manages the floating panel
- **Background service worker**: Handles individual file downloads via Chrome’s downloads API
- **Classroom scoping**: Files are tagged by classroom ID from the URL (`/c/CLASSROOM_ID/...`)
- **SPA navigation**: Detects URL changes when moving between classes and sections
- **Sequential downloads**: 300ms delay between downloads to avoid browser throttling

## Features

- Read-only DOM access — does not modify Google Classroom’s UI
- Independent floating panel
- Multi-tab collection within one class
- Per-classroom file list (other classes’ files are excluded)
- Multi-select and batch download
- Clean filenames (strips Classroom labels like `Attachment: PDF:`)
- Re-download support — downloaded files stay visible in the panel

## Architecture

- **Classroom DOM is read-only** — UI is never injected into Classroom elements
- **Floating panel** — all extension UI lives in a separate container on the page
- **Internal state** — selection and file list are kept in JavaScript, not the DOM

## Permissions

| Permission | Purpose |
|------------|---------|
| `downloads` | Save files to disk |
| `storage` | Remember panel on/off preference |
| `activeTab` | Access the current tab |
| `scripting` | Inject content scripts |
| `classroom.google.com` | Run on Classroom pages |
| `drive.google.com` | Access Drive file URLs |

## Troubleshooting

### Panel not appearing
- Turn on the panel in the extension popup
- Refresh the Classroom page
- Make sure you are on a class page with attachments

### Extension context / connection errors
- Reload the extension, then **hard-refresh** the Classroom tab (Ctrl+Shift+R)

### Files missing from the panel
- Click into each tab/section that has attachments
- Click **Scan Files** after the content has loaded
- Only Drive/Docs attachments are supported

### Wrong or duplicate filename extensions
- Click **Scan Files** again after updating the extension so names are re-detected

### Downloads failing
- Confirm you have permission to access the files in Classroom
- Check Chrome’s download settings and blocked download prompts

## License

This project is for educational purposes.
