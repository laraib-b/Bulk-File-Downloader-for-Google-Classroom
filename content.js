// Content script for Google Classroom
// CRITICAL: Classroom DOM is READ-ONLY. All UI in independent floating panel.

(function() {
  'use strict';
  
  // Global execution guard
  if (window.__gcBulkDownloaderInitialized) {
    console.log('Bulk Downloader: Script already initialized, skipping...');
    return;
  }
  window.__gcBulkDownloaderInitialized = true;
  console.log('Bulk Downloader: Content script loaded');

  // Internal state (not stored in DOM)
  let detectedFiles = []; // All detected files with their classroom IDs
  let selectedFileIds = new Set();
  let pageObserver = null;
  let isScanning = false;
  let currentPageUrl = window.location.href; // Track current Classroom page
  let currentClassroomId = null; // Current classroom ID
  let downloadedFilesByClassroom = {}; // Track downloaded files per classroom: {classroomKey: Set(fileUrls)}
  let panelEnabled = false; // Panel visibility state (default: hidden)
  
  // Load panel toggle state from storage
  function loadPanelToggleState() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['panelEnabled'], (result) => {
        // Default to false (panel hidden by default)
        panelEnabled = result.panelEnabled === true;
        console.log('Bulk Downloader: Panel toggle state loaded:', panelEnabled);
        resolve();
      });
    });
  }

  // Load downloaded files history from storage
  function loadDownloadedFilesHistory() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['downloadedFilesByClassroom'], (result) => {
        if (result.downloadedFilesByClassroom) {
          // Convert arrays back to Sets
          downloadedFilesByClassroom = {};
          for (const [key, fileUrls] of Object.entries(result.downloadedFilesByClassroom)) {
            downloadedFilesByClassroom[key] = new Set(fileUrls);
          }
          console.log('Bulk Downloader: Loaded downloaded files history for', Object.keys(downloadedFilesByClassroom).length, 'classrooms');
          // Debug: Show what was loaded
          for (const [key, fileSet] of Object.entries(downloadedFilesByClassroom)) {
            console.log('Bulk Downloader: Classroom', key, 'has', fileSet.size, 'downloaded files');
          }
        } 
        else {
          console.log('Bulk Downloader: No downloaded files history found in storage');
        }
        resolve();
      });
    });
  }
  
  // Save downloaded files history to storage
  function saveDownloadedFilesHistory() {
    const storageData = {};
    for (const [key, fileSet] of Object.entries(downloadedFilesByClassroom)) {
      storageData[key] = Array.from(fileSet);
    }
    chrome.storage.local.set({ downloadedFilesByClassroom: storageData }, () => {
      console.log('Bulk Downloader: Saved downloaded files history');
      console.log('Bulk Downloader: Storage data:', storageData);
      // Verify it was saved
      chrome.storage.local.get(['downloadedFilesByClassroom'], (result) => {
        console.log('Bulk Downloader: Verification - storage contains:', Object.keys(result.downloadedFilesByClassroom || {}).length, 'classrooms');
      });
    });
  }

  // Initialize
  async function init() {
    console.log('Bulk Downloader: Initializing...');
    // Load panel toggle state first
    await loadPanelToggleState();
    // Load downloaded files history
    await loadDownloadedFilesHistory();
    currentPageUrl = window.location.href;
    currentClassroomId = getClassroomKey(currentPageUrl);
    console.log('Bulk Downloader: Current classroom ID:', currentClassroomId);
    clearFilesForNewPage(); // Clear any old files
    
    // Only create panel if it's enabled
    if (panelEnabled) {
      createFloatingPanel();
    } 
    else {
      console.log('Bulk Downloader: Panel is disabled. Enable it from the extension popup to use.');
    }
    
    setupClickDetection(); // Setup click detection for tabs/sections
    setupMutationObserver();
    setupUrlChangeDetection();
    // Initial scan after page loads (with delay to let content render) - only if panel is enabled
    if (panelEnabled) {
      setTimeout(() => {
        scanForFiles();
      }, 1000);
    }
  }

  // Get classroom key from URL (classroom ID)
  function getClassroomKey(url) {
    try {
      const urlObj = new URL(url);
      // Extract classroom ID from path like /c/CLASSROOM_ID/...
      const match = urlObj.pathname.match(/\/c\/([^\/]+)/);
      if (match) {
        const key = match[1];
        console.log('Bulk Downloader: Extracted classroom key:', key, 'from URL:', url);
        return key;
      }
      // Fallback to full URL if no classroom ID found
      console.log('Bulk Downloader: No classroom ID found in URL, using pathname');
      return urlObj.pathname;
    } 
    catch (e) {
      console.error('Bulk Downloader: Error extracting classroom key:', e);
      return url;
    }
  }
  
  // Normalize URL for comparison (remove query params and fragments that might differ)
  function normalizeFileUrl(url) {
    try {
      const urlObj = new URL(url);
      // Keep only the pathname and important parts, remove query params that might change
      // For Google Drive/Docs, the file ID is what matters
      return urlObj.origin + urlObj.pathname;
    } 
    catch (e) {
      return url;
    }
  }
  
  // Clear files when navigating to a new Classroom page
  async function clearFilesForNewPage() {
    const newUrl = window.location.href;
    const newClassroomId = getClassroomKey(newUrl);
    const oldClassroomId = currentClassroomId;
    
    // Check if we've navigated to a different classroom
    const isDifferentClass = newClassroomId !== oldClassroomId;
    const isDifferentPage = newUrl !== currentPageUrl;
    
    if (isDifferentClass) {
      console.log('Bulk Downloader: New Classroom detected, clearing old files');
      console.log('Bulk Downloader: Old classroom:', oldClassroomId);
      console.log('Bulk Downloader: New classroom:', newClassroomId);
      
      // Reload downloaded files history (in case it was updated)
      await loadDownloadedFilesHistory();
      
      // Remove all files from the old classroom (they should never appear again)
      detectedFiles = detectedFiles.filter(f => f.classroomId !== oldClassroomId);
      
      // Clear selection
      selectedFileIds.clear();
      
      // Update current classroom and URL
      currentClassroomId = newClassroomId;
      currentPageUrl = newUrl;
      
      // Update panel to show only files from new classroom (if any)
      updateFloatingPanel();
    } 
    else if (isDifferentPage) {
      // Same classroom but different section - keep files from this classroom
      console.log('Bulk Downloader: Different section in same classroom, keeping files');
      currentPageUrl = newUrl;
      // Don't clear files - they should remain visible
      updateFloatingPanel();
    }
  }

  // Step 2: Detect files from Classroom DOM (READ-ONLY) - ONLY actual file attachments
  async function scanForFiles(clickedElement) {
    if (isScanning) {
      console.log('Bulk Downloader: Scan already in progress, skipping...');
      return;
    }
    isScanning = true;
    
    // Ensure storage is loaded
    await loadDownloadedFilesHistory();
    
    // Update current classroom ID
    currentClassroomId = getClassroomKey(currentPageUrl);
    
    // Check if URL changed (navigation to new page)
    await clearFilesForNewPage();
    
    console.log('Bulk Downloader: Scanning for file attachments only...');
    console.log('Bulk Downloader: Current classroom ID:', currentClassroomId);
    console.log('Bulk Downloader: Current URL:', currentPageUrl);
    console.log('Bulk Downloader: Downloaded files history:', downloadedFilesByClassroom[currentClassroomId] ? 
                `${downloadedFilesByClassroom[currentClassroomId].size} files` : 'none');
    
    const newFiles = [];
    
    // Determine scope - if clicked element provided, scan only within that section
    // Otherwise scan the entire document
    let scanScope = document;
    if (clickedElement && clickedElement !== document) {
      // Find the parent section/container
      const section = clickedElement.closest('[role="tabpanel"], [role="main"], section, [class*="content"], [class*="panel"]');
      if (section) {
        scanScope = section;
        console.log('Bulk Downloader: Scanning within clicked section');
      } else {
        console.log('Bulk Downloader: Scanning entire document (no section found)');
      }
    } 
    else {
      console.log('Bulk Downloader: Scanning entire document');
    }
    
    // ONLY detect actual file attachments - look for attachment containers first
    // Pattern 1: Attachment containers with data-attachment-id (most reliable)
    const attachmentContainers = scanScope.querySelectorAll('[data-attachment-id]');
    console.log(`Bulk Downloader: Found ${attachmentContainers.length} attachment containers`);
    
    attachmentContainers.forEach((container, idx) => {
      const link = container.querySelector('a[href*="drive.google.com"], a[href*="docs.google.com"], a[href*="drive/userdata"]');
      if (!link) {
        console.log(`Bulk Downloader: Container ${idx} has no file link`);
        return;
      }
      
      const href = link.getAttribute('href');
      if (!href) return;
      
      // Skip if already detected
      if (newFiles.some(f => f.url === href) || detectedFiles.some(f => f.url === href)) {
        return;
      }
      
      // Skip if this file was already downloaded from current classroom
      const currentClassroomKey = getClassroomKey(currentPageUrl);
      
      if (currentClassroomKey && downloadedFilesByClassroom[currentClassroomKey]) {
        const isDownloaded = downloadedFilesByClassroom[currentClassroomKey].has(href);
        console.log('Bulk Downloader: Checking file - Classroom:', currentClassroomKey, 'URL:', href.substring(0, 50) + '...', 'Downloaded:', isDownloaded);
        
        if (isDownloaded) {
          console.log('Bulk Downloader: ✓ SKIPPING already downloaded file!');
          return;
        }
      } 
      else {
        console.log('Bulk Downloader: No downloaded history for classroom:', currentClassroomKey, 'Available classrooms:', Object.keys(downloadedFilesByClassroom));
      }
      
      // Extract file name from attachment
      let fileName = link.textContent.trim() || 
                     link.getAttribute('aria-label') || 
                     container.textContent.trim() ||
                     link.querySelector('span')?.textContent?.trim() ||
                     'Attachment';
      
      // Try to extract from URL if name is too short
      if (!fileName || fileName.length < 3) {
        const urlMatch = href.match(/([^\/]+\.(pdf|doc|docx|ppt|pptx|xls|xlsx|zip|rar|txt|jpg|jpeg|png|gif|mp4|mp3))/i);
        if (urlMatch) {
          fileName = urlMatch[1];
        } 
        else {
          fileName = 'Attachment';
        }
      }
      
      const fileData = {
        id: `file_${Date.now()}_${detectedFiles.length + newFiles.length}_${Math.random().toString(36).substr(2, 9)}`,
        url: href,
        name: fileName,
        element: link,
        classroomId: currentClassroomId // Associate file with current classroom
      };
      
      newFiles.push(fileData);
      console.log('Bulk Downloader: Found file attachment:', fileName, href);
    });
    
    // Pattern 2: File attachment indicators (more strict)
    // Only look for links that are clearly file attachments, not hyperlinks
    const fileLinks = scanScope.querySelectorAll('a[href*="drive.google.com"], a[href*="docs.google.com"], a[href*="drive/userdata"]');
    
    fileLinks.forEach((link, index) => {
      const href = link.getAttribute('href');
      if (!href) return;
      
      // Skip if already detected
      if (newFiles.some(f => f.url === href) || detectedFiles.some(f => f.url === href)) {
        return;
      }
      
      // Check if it's a file attachment
      const isInAttachmentContainer = link.closest('[data-attachment-id]') !== null ||
                                      link.closest('[class*="attachment"]') !== null ||
                                      link.closest('[class*="file-attachment"]') !== null ||
                                      link.closest('[aria-label*="attachment"]') !== null ||
                                      link.closest('[aria-label*="file"]') !== null;
      
      // Check if URL has file ID pattern (actual file, not just sharing link)
      const hasFileId = href.includes('/file/d/') || 
                       href.includes('/document/d/') ||
                       href.includes('/spreadsheets/d/') ||
                       href.includes('/presentation/d/') ||
                       href.includes('drive/userdata');
      
      // EXCLUDE: Regular hyperlinks in announcement text (but allow attachments)
      // Check if link is in announcement/post text content (not in attachment area)
      const isInAnnouncementText = link.closest('[class*="post"]') !== null &&
                                   link.closest('[data-attachment-id]') === null &&
                                   link.closest('[class*="attachment"]') === null &&
                                   !hasFileId; // Only exclude if it's not a file URL
      
      // Include if it's in attachment container OR has file ID
      // Exclude only if it's clearly a hyperlink in announcement text
      if (isInAnnouncementText) {
        console.log('Bulk Downloader: Skipping hyperlink in announcement text:', href);
        return;
      }
      
      // Include if it has file ID or is in attachment container
      if (!isInAttachmentContainer && !hasFileId) {
        console.log('Bulk Downloader: Skipping non-file link:', href);
        return;
      }
      
      // Skip if this file was already downloaded from current classroom
      if (currentClassroomId && downloadedFilesByClassroom[currentClassroomId]) {
        // Check both original and normalized URL
        const normalizedHref = normalizeFileUrl(href);
        const isDownloaded = downloadedFilesByClassroom[currentClassroomId].has(href) || 
                            downloadedFilesByClassroom[currentClassroomId].has(normalizedHref);
        
        if (isDownloaded) {
          console.log('Bulk Downloader: ✓ SKIPPING already downloaded file!');
          console.log('Bulk Downloader: Classroom:', currentClassroomId, 'URL:', href.substring(0, 60) + '...');
          return;
        }
      }
      
      // Extract file name
      let fileName = link.textContent.trim() || 
                     link.getAttribute('aria-label') || 
                     link.querySelector('span')?.textContent?.trim() ||
                     `File ${index + 1}`;
      
      // Try to extract from URL if name is too short
      if (!fileName || fileName.length < 3) {
        const urlMatch = href.match(/([^\/]+\.(pdf|doc|docx|ppt|pptx|xls|xlsx|zip|rar|txt|jpg|jpeg|png|gif|mp4|mp3))/i);
        if (urlMatch) {
          fileName = urlMatch[1];
        } 
        else {
          fileName = `File_${index + 1}`;
        }
      }
      
      const fileData = {
        id: `file_${Date.now()}_${index}_${Math.random().toString(36).substr(2, 9)}`,
        url: href,
        name: fileName,
        element: link,
        classroomId: currentClassroomId // Associate file with current classroom
      };
      
      newFiles.push(fileData);
      console.log('Bulk Downloader: Found file:', fileName);
    });
    
    // Update detected files - only keep files from current classroom
    // Remove files from other classrooms (they should never appear again)
    detectedFiles = detectedFiles.filter(f => {
      // Keep files from current classroom only
      return f.classroomId === currentClassroomId;
    });
    
    // Also remove files that are no longer in DOM
    detectedFiles = detectedFiles.filter(f => {
      return document.contains(f.element);
    });
    
    // Add new files from current classroom
    detectedFiles.push(...newFiles);
    
    // Filter to show only files from current classroom
    const currentClassroomFiles = detectedFiles.filter(f => f.classroomId === currentClassroomId);
    
    console.log(`Bulk Downloader: Total files detected: ${detectedFiles.length} (${newFiles.length} new)`);
    console.log(`Bulk Downloader: Files from current classroom (${currentClassroomId}): ${currentClassroomFiles.length}`);
    console.log(`Bulk Downloader: Current page: ${currentPageUrl}`);
    
    // Update floating panel with new files
    updateFloatingPanel();
    isScanning = false;
  }
  
  // Setup click detection on Classroom tabs/sections
  function setupClickDetection() {
    // Listen for clicks on Classroom navigation tabs and content sections
    document.addEventListener('click', (event) => {
      const target = event.target;
      
      console.log('Bulk Downloader: Click detected on:', target);
      
      // More permissive click detection - scan on any click in the main content area
      const isInMainContent = target.closest('[role="main"]') !== null ||
                              target.closest('main') !== null ||
                              target.closest('[class*="content"]') !== null ||
                              document.body.contains(target);
      
      // Check if click is on a tab, button, or interactive element
      const isInteractiveClick = target.closest('[role="tab"]') !== null ||
                                target.closest('[role="button"]') !== null ||
                                target.closest('button') !== null ||
                                target.closest('[class*="tab"]') !== null ||
                                target.tagName === 'BUTTON' ||
                                target.tagName === 'A';
      
      // Scan on any click in the main content area (more permissive)
      if (isInMainContent) {
        console.log('Bulk Downloader: Content area clicked, scanning for files...');
        // Small delay to let content load
        setTimeout(() => {
          scanForFiles(target);
        }, 500);
      }
    }, true); // Use capture phase to catch clicks early
    
    // Also scan after a short delay on page load (fallback)
    setTimeout(() => {
      console.log('Bulk Downloader: Initial scan after page load...');
      scanForFiles();
    }, 2000);
  }

  // Show the floating panel
  function showFloatingPanel() {
    const panel = document.getElementById('gc-bulk-downloader-panel');
    if (panel) {
      panel.style.display = 'block';
      console.log('Bulk Downloader: Panel shown');
    } else {
      // Panel doesn't exist, create it
      createFloatingPanel();
    }
  }

  // Hide the floating panel
  function hideFloatingPanel() {
    const panel = document.getElementById('gc-bulk-downloader-panel');
    if (panel) {
      panel.style.display = 'none';
      console.log('Bulk Downloader: Panel hidden');
    }
  }

  // Step 4: Create floating panel (independent container, not in Classroom DOM)
  function createFloatingPanel() {
    // Remove existing panel if any
    const existing = document.getElementById('gc-bulk-downloader-panel');
    if (existing) {
      existing.remove();
    }
    
    const panel = document.createElement('div');
    panel.id = 'gc-bulk-downloader-panel';
    panel.className = 'gc-bulk-downloader-panel';
    // Set initial visibility based on toggle state
    panel.style.display = panelEnabled ? 'block' : 'none';
    
    // Panel header
    const header = document.createElement('div');
    header.className = 'gc-panel-header';
    header.innerHTML = '<h3>📥 Bulk File Downloader</h3>';
    
    // File list container
    const fileList = document.createElement('div');
    fileList.id = 'gc-file-list';
    fileList.className = 'gc-file-list';
    
    // Controls
    const controls = document.createElement('div');
    controls.className = 'gc-panel-controls';
    
    // Select all checkbox
    const selectAllDiv = document.createElement('div');
    selectAllDiv.className = 'gc-select-all';
    const selectAllCheckbox = document.createElement('input');
    selectAllCheckbox.type = 'checkbox';
    selectAllCheckbox.id = 'gc-select-all';
    selectAllCheckbox.addEventListener('change', (e) => {
      const checked = e.target.checked;
      selectedFileIds.clear();
      if (checked) {
        detectedFiles.forEach(f => selectedFileIds.add(f.id));
      }
      updateFloatingPanel();
    });
    const selectAllLabel = document.createElement('label');
    selectAllLabel.htmlFor = 'gc-select-all';
    selectAllLabel.textContent = 'Select All';
    selectAllLabel.insertBefore(selectAllCheckbox, selectAllLabel.firstChild);
    selectAllDiv.appendChild(selectAllLabel);
    
    // Selected count
    const countSpan = document.createElement('span');
    countSpan.id = 'gc-selected-count';
    countSpan.className = 'gc-selected-count';
    countSpan.textContent = '0 selected';
    
    // Download button
    const downloadBtn = document.createElement('button');
    downloadBtn.id = 'gc-download-btn';
    downloadBtn.className = 'gc-download-btn';
    downloadBtn.textContent = 'Download Selected';
    downloadBtn.addEventListener('click', downloadSelectedFiles);
    
    // ZIP option
    const zipOption = document.createElement('label');
    zipOption.className = 'gc-zip-option';
    const zipCheckbox = document.createElement('input');
    zipCheckbox.type = 'checkbox';
    zipCheckbox.id = 'gc-zip-option';
    zipCheckbox.checked = true;
    zipOption.appendChild(zipCheckbox);
    zipOption.appendChild(document.createTextNode(' Package as ZIP'));
    
    // Scan Files button
    const scanBtn = document.createElement('button');
    scanBtn.id = 'gc-scan-btn';
    scanBtn.className = 'gc-scan-btn';
    scanBtn.textContent = 'Scan Files';
    scanBtn.style.marginTop = '8px';
    scanBtn.style.background = '#34a853';
    scanBtn.addEventListener('click', () => {
      scanBtn.textContent = 'Scanning...';
      scanBtn.disabled = true;
      scanForFiles();
      setTimeout(() => {
        scanBtn.textContent = 'Scan Files';
        scanBtn.disabled = false;
      }, 1000);
    });
    
    controls.appendChild(selectAllDiv);
    controls.appendChild(countSpan);
    controls.appendChild(zipOption);
    controls.appendChild(downloadBtn);
    controls.appendChild(scanBtn);
    
    // Assemble panel
    panel.appendChild(header);
    panel.appendChild(fileList);
    panel.appendChild(controls);
    
    // Append to body (independent container)
    document.body.appendChild(panel);
    console.log('Bulk Downloader: Floating panel created');
    
    updateFloatingPanel();
  }

  // Update floating panel with current file list
  function updateFloatingPanel() {
    const fileList = document.getElementById('gc-file-list');
    const countSpan = document.getElementById('gc-selected-count');
    const downloadBtn = document.getElementById('gc-download-btn');
    const selectAllCheckbox = document.getElementById('gc-select-all');
    
    if (!fileList) return;
    
    // Filter files to show only those from current classroom
    const currentClassroomFiles = detectedFiles.filter(f => f.classroomId === currentClassroomId);
    
    // Clear and rebuild file list
    fileList.innerHTML = '';
    
    if (currentClassroomFiles.length === 0) {
      fileList.innerHTML = '<div class="gc-no-files">No files detected. Navigate to a page with files.</div>';
      if (countSpan) countSpan.textContent = '0 selected';
      if (downloadBtn) downloadBtn.disabled = true;
      if (selectAllCheckbox) selectAllCheckbox.checked = false;
      return;
    }
    
    // Create file items (only from current classroom)
    currentClassroomFiles.forEach(fileData => {
      const fileItem = document.createElement('div');
      fileItem.className = 'gc-file-item';
      
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'gc-file-checkbox';
      checkbox.dataset.fileId = fileData.id;
      checkbox.checked = selectedFileIds.has(fileData.id);
      checkbox.addEventListener('change', (e) => {
        if (e.target.checked) {
          selectedFileIds.add(fileData.id);
        } 
        else {
          selectedFileIds.delete(fileData.id);
        }
        updateFloatingPanel();
      });
      
      const fileName = document.createElement('span');
      fileName.className = 'gc-file-name';
      fileName.textContent = fileData.name;
      fileName.title = fileData.url;
      
      fileItem.appendChild(checkbox);
      fileItem.appendChild(fileName);
      fileList.appendChild(fileItem);
    });
    
    // Update controls (based on current classroom files)
    if (countSpan) {
      countSpan.textContent = `${selectedFileIds.size} selected`;
    }
    
    if (downloadBtn) {
      downloadBtn.disabled = selectedFileIds.size === 0;
      downloadBtn.textContent = `Download Selected (${selectedFileIds.size})`;
    }
    
    if (selectAllCheckbox) {
      selectAllCheckbox.checked = currentClassroomFiles.length > 0 && 
                                  currentClassroomFiles.every(f => selectedFileIds.has(f.id));
    }
  }

  // Setup URL change detection for SPA navigation
  function setupUrlChangeDetection() {
    // Intercept pushState and replaceState to detect navigation immediately
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    
    history.pushState = function(...args) {
      originalPushState.apply(history, args);
      handleUrlChange();
    };
    
    history.replaceState = function(...args) {
      originalReplaceState.apply(history, args);
      handleUrlChange();
    };
    
    // Listen for popstate (back/forward navigation)
    window.addEventListener('popstate', handleUrlChange);
    
    async function handleUrlChange() {
      const newUrl = window.location.href;
      if (newUrl !== currentPageUrl) {
        console.log('Bulk Downloader: URL changed from', currentPageUrl, 'to', newUrl);
        await clearFilesForNewPage();
        // Don't auto-scan - wait for user to click on a section
      }
    }
    
    // Also check URL periodically as backup (for any missed navigation)
    setInterval(async () => {
      const newUrl = window.location.href;
      if (newUrl !== currentPageUrl) {
        console.log('Bulk Downloader: URL change detected via interval check');
        await clearFilesForNewPage();
        // Don't auto-scan - wait for user to click on a section
      }
    }, 500); // Check every 500ms
  }

  // Step 3: MutationObserver for navigation detection (NO DOM modification)
  function setupMutationObserver() {
    // Disconnect existing observer
    if (pageObserver) {
      pageObserver.disconnect();
    }
    
    // Find main content area to observe
    let observeTarget = document.querySelector('[role="main"]') || 
                        document.querySelector('main') ||
                        document.body;
    
    pageObserver = new MutationObserver(async (mutations) => {
      // Always check for URL changes first (SPA navigation)
      const urlChanged = window.location.href !== currentPageUrl;
      if (urlChanged) {
        console.log('Bulk Downloader: URL changed in MutationObserver, clearing files...');
        await clearFilesForNewPage();
        // Don't auto-scan - wait for user to click on a section
        return;
      }
      
      // Only detect navigation changes, don't modify DOM
      let shouldRescan = false;
      
      mutations.forEach((mutation) => {
        if (mutation.addedNodes.length > 0) {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === 1) { // Element node
              if (node.querySelector && (
                node.querySelector('a[href*="drive.google.com"]') ||
                node.querySelector('a[href*="docs.google.com"]')
              )) {
                shouldRescan = true;
              }
            }
          });
        }
      });
      
      // Don't auto-rescan - wait for user to click on a section
      // This prevents showing files from multiple sections at once
    });
    
    // Start observing (narrow target)
    if (observeTarget && document.contains(observeTarget)) {
      pageObserver.observe(observeTarget, {
        childList: true,
        subtree: true
      });
      console.log('Bulk Downloader: MutationObserver started');
    }
  }

  // Step 5: Send selected URLs to background
  function downloadSelectedFiles() {
    const filesToDownload = detectedFiles.filter(f => selectedFileIds.has(f.id));
    
    if (filesToDownload.length === 0) {
      alert('No files selected');
      return;
    }
    
    const zipOption = document.getElementById('gc-zip-option');
    const createZip = zipOption ? zipOption.checked : true;
    
    console.log('Bulk Downloader: Downloading', filesToDownload.length, 'files, ZIP:', createZip);
    
    // Disable button during download
    const downloadBtn = document.getElementById('gc-download-btn');
    if (downloadBtn) {
      downloadBtn.disabled = true;
      downloadBtn.textContent = 'Downloading...';
    }
    
    // Send message to background script
    chrome.runtime.sendMessage({
      action: 'downloadFiles',
      files: filesToDownload.map(f => ({
        url: f.url,
        name: f.name
      })),
      zip: createZip
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Bulk Downloader: Error:', chrome.runtime.lastError);
        alert('Download error: ' + chrome.runtime.lastError.message);
        if (downloadBtn) {
          downloadBtn.disabled = false;
          downloadBtn.textContent = 'Download Selected';
        }
        return;
      }
      
      if (response && response.success) {
        console.log('Bulk Downloader: Download successful');
        alert(`Successfully downloaded ${filesToDownload.length} file(s)!`);
        
        // Mark files as downloaded for current classroom
        console.log('Bulk Downloader: Marking files as downloaded for classroom:', currentClassroomId);
        
        if (currentClassroomId) {
          if (!downloadedFilesByClassroom[currentClassroomId]) {
            downloadedFilesByClassroom[currentClassroomId] = new Set();
          }
          
          filesToDownload.forEach(file => {
            // Store normalized URL for consistent comparison
            const normalizedUrl = normalizeFileUrl(file.url);
            downloadedFilesByClassroom[currentClassroomId].add(normalizedUrl);
            // Also store original URL as backup
            downloadedFilesByClassroom[currentClassroomId].add(file.url);
            console.log('Bulk Downloader: Marked as downloaded - Original:', file.url);
            console.log('Bulk Downloader: Marked as downloaded - Normalized:', normalizedUrl);
            console.log('Bulk Downloader: Classroom ID:', currentClassroomId);
          });
          
          // Debug: Show all downloaded files for this classroom
          console.log('Bulk Downloader: All downloaded files for classroom', currentClassroomId, ':', 
                      Array.from(downloadedFilesByClassroom[currentClassroomId]));
          
          // Save to storage
          saveDownloadedFilesHistory();
          
          console.log(`Bulk Downloader: Marked ${filesToDownload.length} files as downloaded for classroom ${currentClassroomId}`);
          console.log('Bulk Downloader: Total downloaded files for this classroom:', downloadedFilesByClassroom[currentClassroomId].size);
        }
        
        // Note: Don't remove files from detected files list - they should remain visible as long as classroom is open
        
        // Clear selection
        selectedFileIds.clear();
        updateFloatingPanel();
      } else {
        alert(response?.error || 'Download failed');
        if (downloadBtn) {
          downloadBtn.disabled = false;
          downloadBtn.textContent = 'Download Selected';
        }
      }
    });
  }

  // Fetch file blob (for ZIP creation) - content script has cookie access
  async function fetchFileBlobForZip(url) {
    try {
      console.log('Bulk Downloader: Fetching file from:', url);
      
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        mode: 'cors',
        redirect: 'follow',
        cache: 'no-cache'
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      // Check if we got HTML instead of the actual file
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        console.warn('Bulk Downloader: Received HTML instead of file');
        // Try to extract download link from HTML or use alternative method
        const text = await response.text();
        const downloadMatch = text.match(/href="([^"]*uc[^"]*export=download[^"]*)"/);
        if (downloadMatch) {
          const newUrl = downloadMatch[1].replace(/&amp;/g, '&');
          console.log('Bulk Downloader: Found alternative download URL:', newUrl);
          // Retry with the found URL
          return await fetchFileBlobForZip(newUrl);
        }
        throw new Error('Received HTML page instead of file');
      }
      
      const blob = await response.blob();
      
      if (!blob || blob.size === 0) {
        throw new Error('Received empty blob');
      }
      
      console.log('Bulk Downloader: Successfully fetched blob, size:', blob.size);
      
      // Convert blob to base64 for message passing
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64data = reader.result.split(',')[1]; // Remove data:type;base64, prefix
          resolve(base64data);
        };
        reader.onerror = (error) => {
          console.error('Bulk Downloader: FileReader error:', error);
          reject(new Error('Failed to convert blob to base64'));
        };
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      console.error('Bulk Downloader: Fetch error in content script:', error);
      // Provide more detailed error message
      if (error.message.includes('Failed to fetch')) {
        throw new Error('Network error: Unable to fetch file. The file may require authentication or the URL may be invalid.');
      }
      throw error;
    }
  }

  // Listen for messages from popup and background
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getSelectedFiles') {
      const filesToDownload = detectedFiles.filter(f => selectedFileIds.has(f.id));
      sendResponse({
        files: filesToDownload.map(f => ({
          url: f.url,
          name: f.name
        }))
      });
      return true;
    }
    
    if (request.action === 'refresh') {
      scanForFiles();
      sendResponse({ success: true });
      return true;
    }
    
    // Toggle panel visibility
    if (request.action === 'togglePanel') {
      panelEnabled = request.enabled === true;
      console.log('Bulk Downloader: Panel toggle received, enabled:', panelEnabled);
      
      if (panelEnabled) {
        // Show panel - create if it doesn't exist
        const panel = document.getElementById('gc-bulk-downloader-panel');
        if (!panel) {
          createFloatingPanel();
          // Scan for files when panel is enabled
          setTimeout(() => {
            scanForFiles();
          }, 500);
        } 
        else {
          showFloatingPanel();
        }
      } else {
        // Hide panel
        hideFloatingPanel();
      }
      
      sendResponse({ success: true, enabled: panelEnabled });
      return true;
    }
    
    // Fetch file blob for ZIP creation (content script has cookie access)
    if (request.action === 'fetchFileBlob') {
      fetchFileBlobForZip(request.url)
        .then((blobData) => {
          sendResponse({ blobData: blobData });
        })
        .catch((error) => {
          sendResponse({ error: error.message });
        });
      return true; // Indicates async response
    }
  });

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } 
  else {
    init();
  }
})();
