// Popup script for the extension
// Handles user interactions in the popup UI

document.addEventListener('DOMContentLoaded', () => {
  const refreshBtn = document.getElementById('refreshBtn');
  const togglePanel = document.getElementById('togglePanel');
  const status = document.getElementById('status');

  // Get current active tab
  async function getCurrentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  // Update status message
  function updateStatus(message, isError = false) {
    status.textContent = message;
    status.style.background = isError ? '#ffebee' : '#f0f0f0';
    status.style.color = isError ? '#c62828' : '#333';
  }

  // Load toggle state from storage
  function loadToggleState() {
    chrome.storage.local.get(['panelEnabled'], (result) => {
      // Default to false (disabled) if not set
      const isEnabled = result.panelEnabled === true;
      togglePanel.checked = isEnabled;
      updateToggleStatus(isEnabled);
    });
  }

  // Update status based on toggle state
  function updateToggleStatus(isEnabled) {
    if (isEnabled) {
      status.textContent = 'Panel is enabled. The download interface will appear on Classroom pages.';
      status.style.background = '#e8f5e9';
      status.style.color = '#2e7d32';
    } 
    else {
      status.textContent = 'Panel is disabled. Toggle it on to see the download interface.';
      status.style.background = '#f0f0f0';
      status.style.color = '#333';
    }
  }

  // Toggle panel on/off
  togglePanel.addEventListener('change', async () => {
    const isEnabled = togglePanel.checked;
    
    // Save toggle state to storage
    chrome.storage.local.set({ panelEnabled: isEnabled }, () => {
      console.log('Panel toggle state saved:', isEnabled);
    });

    // Update status
    updateToggleStatus(isEnabled);

    // Send message to content script to show/hide panel
    try {
      const tab = await getCurrentTab();
      
      if (tab.url && tab.url.includes('classroom.google.com')) {
        chrome.tabs.sendMessage(tab.id, { 
          action: 'togglePanel', 
          enabled: isEnabled 
        }, 
        (response) => {
          if (chrome.runtime.lastError) {
            console.log('Content script not ready:', chrome.runtime.lastError.message);
            // This is okay - the content script will check the state on next load
          } else if (response && response.success) {
            console.log('Panel toggle message sent successfully');
          }
        });
      }
    } 
    catch (error) {
      console.error('Error toggling panel:', error);
    }
  });

  // Refresh button click handler
  refreshBtn.addEventListener('click', async () => {
    try {
      const tab = await getCurrentTab();
      
      if (!tab.url || !tab.url.includes('classroom.google.com')) {
        updateStatus('Please open a Google Classroom page', true);
        return;
      }

      // Send refresh message to content script
      chrome.tabs.sendMessage(tab.id, { action: 'refresh' }, (response) => {
        if (chrome.runtime.lastError) {
          updateStatus('Error: ' + chrome.runtime.lastError.message, true);
          return;
        }

        if (response && response.success) {
          updateStatus('File list refreshed!');
        } 
        else {
          updateStatus('Refresh failed', true);
        }
      });
    } 
    catch (error) {
      updateStatus('Error: ' + error.message, true);
    }
  });

  // Check if we're on a Classroom page and update UI accordingly
  getCurrentTab().then(tab => {
    if (!tab.url || !tab.url.includes('classroom.google.com')) {
      updateStatus('Open a Google Classroom page to use this extension', true);
      refreshBtn.disabled = true;
      togglePanel.disabled = false; // Still allow toggling for when they navigate
    } 
    else {
      refreshBtn.disabled = false;
    }
  });

  // Load initial toggle state
  loadToggleState();
});
