// Background service worker for handling downloads
// This script runs in the background and handles file downloads and ZIP creation

// Import JSZip library for ZIP creation
try {
  importScripts('jszip.min.js');
} catch (error) {
  console.warn('Bulk Downloader: JSZip not loaded, ZIP functionality will be limited');
}

console.log('Bulk Downloader: Background service worker loaded');

// Listen for download requests
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'downloadFiles') {
    handleDownloadRequest(request.files, request.zip || false)
      .then((result) => {
        sendResponse(result);
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true; // Indicates we will send response asynchronously
  }
});

// Handle download request
async function handleDownloadRequest(files, createZip) {
  console.log(`Bulk Downloader: Starting download of ${files.length} files, ZIP: ${createZip}`);
  
  try {
    if (createZip) {
      // Download files and create ZIP
      return await downloadAndZipFiles(files);
    } else {
      // Download files individually
      return await downloadFilesIndividually(files);
    }
  } catch (error) {
    console.error('Bulk Downloader: Download error:', error);
    throw error;
  }
}

// Download files individually (sequential with delays)
async function downloadFilesIndividually(files) {
  const downloadResults = [];
  
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    
    // Sequential download with delay to avoid throttling
    if (i > 0) {
      await delay(300); // 300ms delay between downloads
    }
    
    try {
      console.log(`Bulk Downloader: Downloading ${i + 1}/${files.length}: ${file.name}`);
      
      // Convert Google Drive/Docs URL to direct download URL
      const directUrl = convertToDirectDownloadUrl(file.url, file.name);
      console.log(`Bulk Downloader: Original URL: ${file.url}`);
      console.log(`Bulk Downloader: Direct download URL: ${directUrl}`);
      
      // Ensure filename has proper extension
      let fileName = sanitizeFileName(file.name);
      const extension = getFileExtension(fileName);
      
      // If no extension, try to infer from URL or use default
      if (!extension) {
        // Try to infer from URL
        if (directUrl.includes('format=docx')) {
          fileName += '.docx';
        } else if (directUrl.includes('format=pdf')) {
          fileName += '.pdf';
        } else if (directUrl.includes('format=xlsx')) {
          fileName += '.xlsx';
        } else if (directUrl.includes('format=pptx')) {
          fileName += '.pptx';
        } else if (directUrl.includes('format=csv')) {
          fileName += '.csv';
        }
      }
      
      // Use chrome.downloads API directly - Chrome handles authentication and redirects automatically
      // No need to fetch blob first - Chrome will use the user's session cookies
      const downloadId = await new Promise((resolve, reject) => {
        chrome.downloads.download({
          url: directUrl,
          filename: fileName,
          saveAs: false // Download to default location
        }, (downloadId) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(downloadId);
          }
        });
      });
      
      downloadResults.push({ id: downloadId, name: file.name });
    } catch (error) {
      console.error(`Bulk Downloader: Failed to download ${file.name}:`, error);
      // Continue with other files even if one fails
    }
  }
  
  return {
    success: true,
    files: downloadResults,
    message: `Downloaded ${downloadResults.length} file(s)`
  };
}

// Download files and create ZIP
async function downloadAndZipFiles(files) {
  console.log('Bulk Downloader: Downloading files for ZIP...');
  
  // Check if JSZip is available
  if (typeof JSZip === 'undefined') {
    console.log('Bulk Downloader: JSZip not available, downloading individually');
    return await downloadFilesIndividually(files);
  }
  
  try {
    // Request content script to fetch files (has access to page cookies)
    // Get the active tab to send message to content script
    const tabs = await new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, resolve);
    });
    
    if (!tabs || tabs.length === 0) {
      throw new Error('No active tab found');
    }
    
    const tab = tabs[0];
    if (!tab.url || !tab.url.includes('classroom.google.com')) {
      throw new Error('Not on a Classroom page');
    }
    
    const zip = new JSZip();
    let filesAdded = 0;
    
    // Request content script to fetch each file
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      
      // Delay between requests
      if (i > 0) {
        await delay(300);
      }
      
      try {
        console.log(`Bulk Downloader: Requesting fetch for ${i + 1}/${files.length}: ${file.name}`);
        
        // Convert URL to direct download URL
        const directUrl = convertToDirectDownloadUrl(file.url, file.name);
        
        // Request content script to fetch the file (has cookie access)
        const blobData = await new Promise((resolve, reject) => {
          chrome.tabs.sendMessage(tab.id, {
            action: 'fetchFileBlob',
            url: directUrl
          }, (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (response && response.error) {
              reject(new Error(response.error));
            } else if (response && response.blobData) {
              resolve(response.blobData);
            } else {
              reject(new Error('No blob data received'));
            }
          });
        });
        
        // Convert base64 back to blob
        const byteCharacters = atob(blobData);
        const byteNumbers = new Array(byteCharacters.length);
        for (let j = 0; j < byteCharacters.length; j++) {
          byteNumbers[j] = byteCharacters.charCodeAt(j);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray]);
        
        // Add to ZIP
        zip.file(sanitizeFileName(file.name), blob);
        filesAdded++;
        console.log(`Bulk Downloader: Added ${file.name} to ZIP`);
      } catch (error) {
        console.error(`Bulk Downloader: Failed to fetch ${file.name}:`, error);
        // Continue with other files
      }
    }
    
    // Check if any files were successfully added
    if (filesAdded === 0) {
      console.warn('Bulk Downloader: No files could be fetched for ZIP, falling back to individual downloads');
      return await downloadFilesIndividually(files);
    }
    
    console.log(`Bulk Downloader: Successfully added ${filesAdded}/${files.length} files to ZIP`);
    
    // Generate ZIP blob
    console.log('Bulk Downloader: Generating ZIP file...');
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    
    // Convert blob to base64 data URL (service workers don't support URL.createObjectURL)
    const zipDataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(zipBlob);
    });
    
    const zipFileName = `Classroom_Files_${new Date().toISOString().split('T')[0]}.zip`;
    
    return new Promise((resolve, reject) => {
      chrome.downloads.download({
        url: zipDataUrl,
        filename: zipFileName,
        saveAs: false
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve({
            success: true,
            files: [{ id: downloadId, name: zipFileName }],
            message: `Created ZIP with ${files.length} file(s)`
          });
        }
      });
    });
  } catch (error) {
    console.error('Bulk Downloader: ZIP creation failed, downloading individually:', error);
    // Fallback to individual downloads
    return await downloadFilesIndividually(files);
  }
}

// Note: File fetching for ZIP is done in content script (has cookie access)
// Background worker cannot fetch due to CORS restrictions

// Convert Google Drive/Docs URLs to direct download URLs
function convertToDirectDownloadUrl(url, fileName) {
  // Extract file ID from various Google URL formats
  let fileId = null;
  
  // Google Drive file URLs: https://drive.google.com/file/d/FILE_ID/view
  const driveMatch = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (driveMatch) {
    fileId = driveMatch[1];
    // Convert to direct download URL
    // Using confirm=t to bypass virus scan warning for large files
    return `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;
  }
  
  // Google Docs: https://docs.google.com/document/d/FILE_ID/edit
  const docsMatch = url.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (docsMatch) {
    fileId = docsMatch[1];
    // Determine export format from file extension
    const extension = getFileExtension(fileName).toLowerCase();
    let format = 'pdf'; // default
    
    if (extension === 'docx' || extension === 'doc') {
      format = 'docx';
    } else if (extension === 'txt') {
      format = 'txt';
    } else if (extension === 'rtf') {
      format = 'rtf';
    } else if (extension === 'odt') {
      format = 'odt';
    }
    // else default to pdf
    
    return `https://docs.google.com/document/d/${fileId}/export?format=${format}`;
  }
  
  // Google Sheets: https://docs.google.com/spreadsheets/d/FILE_ID/edit
  const sheetsMatch = url.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (sheetsMatch) {
    fileId = sheetsMatch[1];
    const extension = getFileExtension(fileName).toLowerCase();
    let format = 'xlsx'; // default
    
    if (extension === 'csv') {
      format = 'csv';
    } else if (extension === 'ods') {
      format = 'ods';
    } else if (extension === 'pdf') {
      format = 'pdf';
    }
    // else default to xlsx
    
    return `https://docs.google.com/spreadsheets/d/${fileId}/export?format=${format}`;
  }
  
  // Google Slides: https://docs.google.com/presentation/d/FILE_ID/edit
  const slidesMatch = url.match(/docs\.google\.com\/presentation\/d\/([a-zA-Z0-9_-]+)/);
  if (slidesMatch) {
    fileId = slidesMatch[1];
    const extension = getFileExtension(fileName).toLowerCase();
    let format = 'pptx'; // default
    
    if (extension === 'pdf') {
      format = 'pdf';
    } else if (extension === 'odp') {
      format = 'odp';
    }
    // else default to pptx
    
    return `https://docs.google.com/presentation/d/${fileId}/export/${format}`;
  }
  
  // If no match, return original URL (might be a direct link already)
  console.log('Bulk Downloader: Could not convert URL, using original:', url);
  return url;
}

// Get file extension from filename
function getFileExtension(fileName) {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1 || lastDot === fileName.length - 1) {
    return ''; // No extension
  }
  return fileName.substring(lastDot + 1);
}

// Sanitize file name for safe download
function sanitizeFileName(fileName) {
  // Remove invalid characters
  return fileName
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

// Delay utility function
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Handle download events
chrome.downloads.onChanged.addListener((downloadDelta) => {
  if (downloadDelta.state && downloadDelta.state.current === 'complete') {
    console.log('Bulk Downloader: Download completed:', downloadDelta.id);
  } else if (downloadDelta.state && downloadDelta.state.current === 'interrupted') {
    console.error('Bulk Downloader: Download interrupted:', downloadDelta.id);
  }
});
