# Bulk File Downloader for Google Classroom

## Installation

1. Download/Clone the Extension
2. Make sure all files are in the `Bulk-File-Downloader-for-Google-Classroom-main` folder
3. Open Google Chrome and navigate to `chrome://extensions/`
   Or go to Menu -> More Tools -> Extensions
4. Toggle the "Developer mode" switch in the top-right corner
5. Click "Load unpacked" button
6. Select the `Bulk-File-Downloader-for-Google-Classroom-main` folder (the folder containing `manifest.json`)

The extension should now appear in your extensions list. You should see the extension icon in your Chrome toolbar. The extension name should be "Bulk File Downloader for Google Classroom"

## Usage

1. Open Google Classroom and navigate to `https://classroom.google.com`
2. Open any class with files/attachments

A floating panel will appear in the top-right corner. It automatically detects files on the current page

3. **Select Files**
   - Check the boxes next to files you want to download
   - Use "Select All" to select all files at once

4. **Download**
   - Check "Package as ZIP" if you want a single ZIP file
   - Click "Download Selected" button
   - Files will download sequentially to avoid throttling

## Project Structure

```
ext/
├── manifest.json          # Extension manifest (Manifest V3)
├── background.js          # Service worker for downloads
├── content.js             # Content script (read-only DOM access)
├── content.css            # Styles for floating panel
├── popup.html             # Extension popup UI
├── popup.js                # Popup script
├── jszip.min.js           # JSZip library for ZIP creation
├── icons/                 # Extension icons
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md              # This file
```

## Technical Details

- **Manifest Version**: 3
- **Content Script**: Reads Classroom DOM (read-only), detects files
- **Floating Panel**: Independent UI container, not injected into Classroom
- **Background Script**: Handles file downloads and ZIP creation
- **MutationObserver**: Detects navigation changes only (no DOM modification)
- **Sequential Downloads**: 300ms delay between downloads to avoid throttling

## Features

- **Read-only DOM access** - Never modifies Google Classroom's UI
- **Independent floating panel** - All UI in separate container
- **File detection** - Automatically detects downloadable files
- **Multi-select** - Select individual files or all at once
- **Batch download** - Download all selected files automatically
- **ZIP packaging** - Optional ZIP file creation
- **Sequential downloads** - Prevents browser throttling
- **SPA navigation support** - Works with dynamic page changes

## Architecture

This extension follows a **critical architecture rule**:

- **Classroom DOM is READ-ONLY** - Never injects UI into Classroom elements
- **Independent floating panel** - All extension UI lives in a separate container
- **Internal state management** - Selection state stored in JavaScript, not DOM
- **Safe MutationObserver** - Only detects navigation, never modifies DOM

## Permissions

- `downloads`: To download files
- `storage`: To store user preferences
- `activeTab`: To access current tab
- `scripting`: To inject content scripts
- `https://classroom.google.com/*`: To access Classroom pages
- `https://drive.google.com/*`: To access Drive files

## Development Notes

- The extension works entirely client-side
- No backend server required
- Uses browser's logged-in session for authentication
- Files are downloaded using Chrome's downloads API
- Classroom DOM is never modified (read-only access)

## Limitations

- Can only download files you have access to
- Cannot bypass Google's permission system
- Some Drive links may expire quickly
- Downloads must start immediately after selection

## Troubleshooting

### Floating Panel Not Appearing
- Refresh the Classroom page if files get messy
- Check browser console (F12) for errors
- Make sure you're on a Classroom page with files

### Files Not Detected
- Open browser console (F12)
- Look for "Bulk Downloader: Found file:" messages
- Some file types may not be detected automatically

### Downloads Not Working
- Check that you have permission to download files
- Some files may require clicking through Google Drive first
- Check Chrome's download settings

## License

This project is for educational purposes.
