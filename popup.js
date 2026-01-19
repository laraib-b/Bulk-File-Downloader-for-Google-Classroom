// Popup script for the extension
// Handles user interactions in the popup UI

document.addEventListener('DOMContentLoaded', () => {
  const refreshBtn = document.getElementById('refreshBtn');
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
        } else {
          updateStatus('Refresh failed', true);
        }
      });
    } catch (error) {
      updateStatus('Error: ' + error.message, true);
    }
  });

  // Check if we're on a Classroom page and update UI accordingly
  getCurrentTab().then(tab => {
    if (!tab.url || !tab.url.includes('classroom.google.com')) {
      updateStatus('Open a Google Classroom page to use this extension', true);
      refreshBtn.disabled = true;
    }
  });
});
