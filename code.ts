// Figma Plugin API version 1
// This plugin implements a time tracking feature for Figma files

// Constants for timer management
const FILE_CHECK_INTERVAL = 1000; // How often to check for file changes (in ms)
const ACTIVITY_CHECK_INTERVAL = 5000; // How often to check for activity (in ms)
const SAVE_INTERVAL = 60000; // How often to save to local storage (in ms)
const INACTIVE_THRESHOLD = 5000; // Consider user inactive after this time (in ms)
const NOTIFICATION_INTERVAL = 900000; // Show notification every 15 minutes (15 * 60 * 1000 ms)

// Add new constant for background activity check
const BACKGROUND_CHECK_INTERVAL = 5000; // Check background activity every 5 seconds

// Add new constant for auto-start detection
const AUTO_START_THRESHOLD = 2000; // Time in ms to detect sustained activity before auto-starting

// Add new constant for recent update threshold
const RECENT_UPDATE_THRESHOLD = 300000; // 5 minutes in milliseconds

// Storage keys
const SUMMARY_STORAGE_KEY = 'timeTrackingSummary';
const LAST_UPDATE_KEY = 'lastSummaryUpdate';
const BACKGROUND_TRACKING_KEY = 'backgroundTracking';

// Add type definitions at the top of the file
interface PageData {
  id: string;
  name: string;
  totalTime: number;
  fileId: string;
  lastUpdated: number;
}

interface FileData {
  id: string;
  name: string;
  pages: { [key: string]: PageData };
  totalTime: number;
  lastUpdated: number;
}

interface Files {
  [key: string]: FileData;
}

// Global variables
let isTracking = false;
let isUiVisible = false;
let backgroundTracking = true;
let activeFileId: string | null = null;
let activePage: PageNode | null = null;
let activeFileName = '';
let activePageName = '';
let lastActivityTime = Date.now();
let lastSaveTime = Date.now();
let fileCheckInterval: number;
let activityCheckInterval: number;
let saveInterval: number;
let files: Files = {};
let trackingStartTime = 0;
let lastNotificationTime = Date.now();

// Add background interval
let backgroundCheckInterval: number;

// Add new variables for activity detection
let lastAutoStartCheck = Date.now();
let sustainedActivityStart: number | null = null;

// Plugin initialization
figma.showUI(__html__, { width: 300, height: 400 });

// Register the plugin close handler
figma.on('close', async () => {
  console.log('Plugin UI closing, continuing in background...');
  isUiVisible = false;
  
  // Start background checking if not already running
  if (!backgroundCheckInterval) {
    backgroundCheckInterval = setInterval(checkBackgroundActivity, BACKGROUND_CHECK_INTERVAL);
  }
  
  // If tracking is active, show notification
  if (isTracking) {
    figma.notify('Time tracking continues in background. Open plugin to stop tracking.');
  }
});

figma.on('run', () => {
  isUiVisible = true;
  // Clear background interval when UI opens
  if (backgroundCheckInterval) {
    clearInterval(backgroundCheckInterval);
    backgroundCheckInterval = 0;
  }
});

// First, load all pages before registering event handlers
figma.loadAllPagesAsync().then(() => {
  // Register event handlers
  figma.on('selectionchange', () => {
    handleActivity();
  });
  
  figma.on('documentchange', () => {
    handleActivity();
  });
  
  console.log('All pages loaded, event handlers registered');
  
  // Start the plugin after a short delay to ensure UI is ready
  setTimeout(initializePlugin, 100);
}).catch(error => {
  console.error('Error loading all pages:', error);
  setTimeout(initializePlugin, 100);
});

// Add this after other event listeners in the plugin initialization
figma.on('documentchange', (event) => {
  handleActivity();
  
  // Check if any page names have changed
  if (files[activeFileId]) {
    Object.keys(files[activeFileId].pages).forEach(pageId => {
      const page = figma.root.findOne(node => node.id === pageId) as PageNode;
      if (page && files[activeFileId].pages[pageId].name !== page.name) {
        // Update the page name in our tracking data
        files[activeFileId].pages[pageId].name = page.name;
        console.log('Updated page name:', pageId, page.name);
        
        // Save the changes
        saveData();
        
        // Notify UI of the name change
        if (isUiVisible) {
          figma.ui.postMessage({
            type: 'summary-data',
            data: files,
            currentFileId: activeFileId
          });
        }
      }
    });
  }
});

// Handle messages from the UI
figma.ui.onmessage = async (message: any) => {
  const pluginMessage = message as {type: string, [key: string]: any};
  console.log('Message received from UI:', pluginMessage.type);

  if (pluginMessage.type === 'resize') {
    // Resize the plugin window
    figma.ui.resize(300, pluginMessage.height);
  }
  else if (pluginMessage.type === 'ui-loaded') {
    isUiVisible = true;
    // Ensure we have fresh data
    await loadSummaryFromClientStorage();
    updateTrackingStatus();
    
    // Send summary data with temporary highlight for last tracked page
    figma.ui.postMessage({
      type: 'summary-data',
      data: files,
      currentFileId: activeFileId,
      recentlyUpdatedPage: isTracking ? {
        fileId: activeFileId,
        pageId: activePage?.id,
        timestamp: Date.now()
      } : findLastTrackedPage() // Add highlight for last tracked page even if not currently tracking
    });
  }
  else if (pluginMessage.type === 'stop-tracking') {
    console.log('Stop tracking requested from UI');
    await stopTracking();
  }
  else if (pluginMessage.type === 'start-tracking') {
    console.log('Start tracking requested from UI');
    handleActivity();
  }
  else if (pluginMessage.type === 'get-summary') {
    // Reload data before sending
    await loadSummaryFromClientStorage();
    figma.ui.postMessage({
      type: 'summary-data',
      data: files,
      currentFileId: activeFileId
    });
  }
};

// Initialize plugin
async function initializePlugin() {
  console.log('Initializing plugin');
  
  // Load summary first
  await loadSummaryFromClientStorage();
  
  // Set up current file and page
  const currentFileId = figma.currentPage.parent.id;
  const currentFileName = (figma.currentPage.parent as DocumentNode).name;
  activeFileId = currentFileId;
  activePage = figma.currentPage;
  activeFileName = currentFileName;
  activePageName = figma.currentPage.name;
  
  // Initialize file structure if needed
  if (!files[activeFileId]) {
    files[activeFileId] = {
      id: activeFileId,
      name: activeFileName,
      pages: {},
      totalTime: 0,
      lastUpdated: Date.now()
    };
  }
  
  // Load background tracking preference
  const bgTracking = await figma.clientStorage.getAsync(BACKGROUND_TRACKING_KEY);
  if (bgTracking !== null) {
    backgroundTracking = bgTracking;
  }
  
  // Set up intervals
  fileCheckInterval = setInterval(checkCurrentFile, FILE_CHECK_INTERVAL);
  activityCheckInterval = setInterval(checkActivity, ACTIVITY_CHECK_INTERVAL);
  saveInterval = setInterval(saveData, SAVE_INTERVAL);
  
  // Send initial data to UI
  if (isUiVisible) {
    updateTrackingStatus();
    figma.ui.postMessage({
      type: 'summary-data',
      data: files,
      currentFileId: activeFileId
    });
  }
}

// Handle user activity
function handleActivity() {
  lastActivityTime = Date.now();
  
  if (!isTracking) {
    startTracking();
  }
}

// Add notification helper function
function showBackgroundNotification(message: string, timeout: number = 2000) {
  if (!isUiVisible) {
    figma.notify(message, { timeout });
  }
}

// Start time tracking
function startTracking() {
  if (isTracking) return;
  
  isTracking = true;
  console.log('Started tracking');
  
  // Ensure we have current file and page info
  const currentFileId = figma.currentPage.parent.id;
  const currentFileName = (figma.currentPage.parent as DocumentNode).name;
  const currentPageId = figma.currentPage.id;
  const currentPageName = figma.currentPage.name;
  
  // Update active file and page info
  activeFileId = currentFileId;
  activeFileName = currentFileName;
  activePage = figma.currentPage;
  activePageName = currentPageName;
  
  // Create or update file entry
  if (!files[activeFileId]) {
    files[activeFileId] = {
      id: activeFileId,
      name: activeFileName,
      pages: {},
      totalTime: 0,
      lastUpdated: Date.now()
    };
  }
  
  // Create or update page entry
  if (!files[activeFileId].pages[activePage.id]) {
    files[activeFileId].pages[activePage.id] = {
      id: activePage.id,
      name: activePageName,
      totalTime: 0,
      fileId: activeFileId,
      lastUpdated: Date.now()
    };
  }
  
  trackingStartTime = Date.now();
  lastNotificationTime = Date.now();
  lastActivityTime = Date.now();
  
  // Show start tracking notification in background
  showBackgroundNotification(`Started tracking time on "${activePageName}"`, 3000);
  
  updateTrackingStatus();
  saveData();
}

// Stop time tracking
async function stopTracking() {
  if (!isTracking) return;
  
  // Update final time before stopping
  updateCurrentSessionTime();
  
  isTracking = false;
  const endTime = Date.now();
  const duration = endTime - trackingStartTime;
  
  // Save immediately when stopping
  await saveData();
  
  // Show stop tracking notification in background
  const timeTracked = formatDuration(Math.floor(duration / 1000));
  showBackgroundNotification(`Stopped tracking "${activePageName}"\nTime tracked: ${timeTracked}`, 3000);
  
  // Update UI if visible
  if (isUiVisible) {
    figma.ui.postMessage({
      type: 'summary-data',
      data: files,
      currentFileId: activeFileId
    });
    
    figma.ui.postMessage({ 
      type: 'tracking-status', 
      isTracking: false 
    });
  }
  
  console.log('Stopped tracking');
}

// Update UI with current tracking status
function updateTrackingStatus() {
  figma.ui.postMessage({
    type: 'tracking-status',
    isTracking: isTracking,
    backgroundTracking: backgroundTracking,
    fileName: activeFileName,
    pageName: activePageName,
    startTime: isTracking ? trackingStartTime : null,
    fileId: activeFileId,
    pageId: activePage.id
  });
}

// Check if the current file has changed
function checkCurrentFile() {
  try {
    const currentFileId = figma.currentPage.parent.id;
    const currentPageId = figma.currentPage.id;
    const currentFileName = (figma.currentPage.parent as any).name;
    const currentPageName = figma.currentPage.name;
    
    if (currentFileId !== activeFileId || currentPageId !== activePage.id) {
      handleFileChange(currentFileId, currentPageId, currentFileName, currentPageName);
    }
  } catch (error) {
    console.error('Error checking current file:', error);
  }
}

// Handle file or page change
async function handleFileChange(newFileId: string, newPageId: string, newFileName: string, newPageName: string) {
  console.log('File change detected:', { newFileId, newPageId, newFileName, newPageName });
  
  const fileChanged = newFileId !== activeFileId;
  const pageChanged = newPageId !== activePage.id;
  
  if (fileChanged || pageChanged) {
    // If tracking was active, stop it for the previous file/page
    if (isTracking) {
      await stopTracking();
      // Show page change notification in background
      showBackgroundNotification(`Switched from "${activePageName}" to "${newPageName}"`, 3000);
    }
    
    // Update active file and page info
    activeFileId = newFileId;
    activePage = figma.currentPage;
    activeFileName = newFileName;
    activePageName = newPageName;
    
    // Initialize file structure if it doesn't exist
    if (!files[activeFileId]) {
      files[activeFileId] = {
        id: activeFileId,
        name: activeFileName,
        pages: {},
        totalTime: 0,
        lastUpdated: Date.now()
      };
    }
    
    // Initialize or update page structure
    if (!files[activeFileId].pages[activePage.id]) {
      files[activeFileId].pages[activePage.id] = {
        id: activePage.id,
        name: activePageName,
        totalTime: 0,
        fileId: activeFileId,
        lastUpdated: Date.now()
      };
    } else {
      // Update page name if it changed
      files[activeFileId].pages[activePage.id].name = activePageName;
      files[activeFileId].pages[activePage.id].fileId = activeFileId;
    }
    
    // Clean up any orphaned pages in the current file
    if (files[activeFileId].pages) {
      Object.values(files[activeFileId].pages).forEach((page: PageData) => {
        if (!page.fileId || page.fileId !== activeFileId) {
          delete files[activeFileId].pages[page.id];
        }
      });
    }
    
    // Notify UI of file change
    figma.ui.postMessage({
      type: 'file-changed',
      fileName: activeFileName,
      pageName: activePageName,
      resetTimer: true
    });
    
    // Send updated summary data
    figma.ui.postMessage({
      type: 'summary-data',
      data: files
    });
    
    // If background tracking is enabled, start tracking the new file/page
    if (backgroundTracking) {
      startTracking();
    }
    
    // Save the updated data
    await saveData();
  }
}

// Check for user activity
function checkActivity() {
  const now = Date.now();
  
  // Only stop tracking if user is truly inactive and UI is visible
  if (isTracking && isUiVisible && (now - lastActivityTime > INACTIVE_THRESHOLD)) {
    const hadRecentChanges = checkForRecentChanges();
    
    if (!hadRecentChanges) {
      console.log('User inactive, stopping tracking');
      stopTracking();
    }
  }
}

// Add function to check for recent document changes
function checkForRecentChanges(): boolean {
  const now = Date.now();
  let hasActivity = false;

  // Check selection changes
  if (figma.currentPage.selection.length > 0) {
    hasActivity = true;
  }

  // Check viewport changes
  const viewport = figma.viewport;
  if (viewport.zoom !== 1 || viewport.center.x !== 0 || viewport.center.y !== 0) {
    hasActivity = true;
  }

  // Check if current page has changed
  if (activePage && activePage !== figma.currentPage) {
    hasActivity = true;
    activePage = figma.currentPage;
  }

  if (hasActivity) {
    lastActivityTime = now;
    return true;
  }

  // Check if we're still within activity timeout
  return (now - lastActivityTime) < RECENT_UPDATE_THRESHOLD;
}

// Save data to client storage
async function saveData() {
  try {
    // Clean up data before saving
    Object.keys(files).forEach(fileId => {
      const file = files[fileId];
      if (!file.pages) file.pages = {};
      
      // Update file total time
      file.totalTime = Object.values(file.pages).reduce((total, page: PageData) => {
        return total + (page?.totalTime || 0);
      }, 0);
      
      // Remove invalid pages
      Object.keys(file.pages).forEach(pageId => {
        const page = file.pages[pageId];
        if (!page || !page.id || !page.fileId || !page.name) {
          delete file.pages[pageId];
        }
      });
    });
    
    await saveSummaryToClientStorage(files);
    lastSaveTime = Date.now();
    
    // Send update to UI if visible
    if (isUiVisible) {
      figma.ui.postMessage({
        type: 'summary-data',
        data: files,
        currentFileId: activeFileId
      });
    }
  } catch (error) {
    console.error('Error saving data:', error);
    figma.notify('Error saving tracking data', { error: true });
  }
}

// Client storage functions
async function saveSummaryToClientStorage(summaryData: any) {
  try {
    await figma.clientStorage.setAsync(SUMMARY_STORAGE_KEY, summaryData);
    await figma.clientStorage.setAsync(LAST_UPDATE_KEY, Date.now());
    console.log('Summary saved to client storage');
  } catch (error) {
    console.error('Error saving to client storage:', error);
  }
}

async function loadSummaryFromClientStorage() {
  try {
    const summaryData = await figma.clientStorage.getAsync(SUMMARY_STORAGE_KEY);
    const lastUpdate = await figma.clientStorage.getAsync(LAST_UPDATE_KEY);
    console.log('Summary loaded from client storage, last updated:', new Date(lastUpdate));
    
    if (summaryData) {
      files = summaryData;
      
      // Clean up and validate the data
      Object.keys(files).forEach(fileId => {
        const file = files[fileId];
        if (!file.pages) file.pages = {};
        
        // Recalculate file total time
        file.totalTime = Object.values(file.pages).reduce((total, page: PageData) => {
          return total + (page?.totalTime || 0);
        }, 0);
        
        // Remove invalid pages
        Object.keys(file.pages).forEach(pageId => {
          const page = file.pages[pageId];
          if (!page || !page.id || !page.fileId || !page.name) {
            delete file.pages[pageId];
          }
        });
        
        // Remove empty files
        if (Object.keys(file.pages).length === 0) {
          delete files[fileId];
        }
      });
      
      // Send immediate update to UI
      if (isUiVisible) {
        figma.ui.postMessage({
          type: 'summary-data',
          data: files,
          currentFileId: activeFileId
        });
      }
    }
    return files;
  } catch (error) {
    console.error('Error loading from client storage:', error);
    return {};
  }
}

// Add duration formatting function
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

// Add background activity checking
function checkBackgroundActivity() {
  const now = Date.now();
  
  try {
    // Get current file and page info
    const currentFileId = figma.currentPage.parent.id;
    const currentPageId = figma.currentPage.id;
    const currentFileName = (figma.currentPage.parent as DocumentNode).name;
    const currentPageName = figma.currentPage.name;
    
    // Check if file or page changed
    if (currentFileId !== activeFileId || currentPageId !== activePage.id) {
      handleFileChange(currentFileId, currentPageId, currentFileName, currentPageName);
    }
    
    // Enhanced activity detection
    const hasSelection = figma.currentPage.selection.length > 0;
    const viewportChanged = figma.viewport.zoom !== figma.viewport.zoom;
    const hasRecentChanges = checkForRecentChanges();
    
    if (hasSelection || viewportChanged || hasRecentChanges) {
      lastActivityTime = now;
      
      // Handle auto-start tracking with immediate feedback
      if (!isTracking && backgroundTracking) {
        if (!sustainedActivityStart) {
          sustainedActivityStart = now;
        } else if (now - sustainedActivityStart >= AUTO_START_THRESHOLD) {
          showBackgroundNotification('Activity detected, starting time tracking...', 3000);
          startTracking();
          sustainedActivityStart = 0;
          
          // Force an immediate time update
          updateCurrentSessionTime();
          saveData();
        }
      }
    } else {
      sustainedActivityStart = 0;
    }
    
    // Update and save time more frequently in background
    if (isTracking) {
      updateCurrentSessionTime();
      
      // Show periodic notifications with more details
      if (!isUiVisible && (now - lastNotificationTime > NOTIFICATION_INTERVAL)) {
        const timeTracked = formatDuration(Math.floor((now - trackingStartTime) / 1000));
        const totalPageTime = formatDuration(Math.floor((files[activeFileId]?.pages[activePage.id]?.totalTime || 0) / 1000));
        showBackgroundNotification(
          `Still tracking time on "${activePageName}"\nCurrent session: ${timeTracked}\nTotal page time: ${totalPageTime}`, 
          5000
        );
        lastNotificationTime = now;
        saveData();
      }
    }
  } catch (error) {
    console.error('Error in background activity check:', error);
  }
}

// Add function to update current session time
function updateCurrentSessionTime() {
  if (!isTracking || !activeFileId || !activePage) return;
  
  const now = Date.now();
  const elapsedTime = now - lastActivityTime;
  lastActivityTime = now;
  
  if (files[activeFileId] && files[activeFileId].pages[activePage.id]) {
    const file = files[activeFileId];
    const page = file.pages[activePage.id];
    
    // Calculate the increment since last update
    const previousTotal = page.totalTime || 0;
    const timeIncrement = elapsedTime;
    page.totalTime = previousTotal + timeIncrement;
    page.lastUpdated = now;
    
    // Update file total time
    file.totalTime = Object.values(file.pages).reduce((total, p) => total + (p.totalTime || 0), 0);
    file.lastUpdated = now;
    
    // Save data periodically
    if (now - lastSaveTime >= SAVE_INTERVAL) {
      saveData();
    }
    
    // Send update to UI with recently updated page info
    figma.ui.postMessage({
      type: 'summary-data',
      data: files,
      currentFileId: activeFileId,
      recentlyUpdatedPage: {
        fileId: activeFileId,
        pageId: activePage.id,
        timestamp: now
      }
    });
  }
}

// Add helper function to find the last tracked page
function findLastTrackedPage() {
  let lastUpdated = 0;
  let lastPage = null;
  
  Object.keys(files).forEach(fileId => {
    Object.keys(files[fileId].pages).forEach(pageId => {
      const page = files[fileId].pages[pageId];
      if (page.lastUpdated > lastUpdated) {
        lastUpdated = page.lastUpdated;
        lastPage = {
          fileId: fileId,
          pageId: pageId,
          timestamp: page.lastUpdated
        };
      }
    });
  });
  
  return lastPage;
}
