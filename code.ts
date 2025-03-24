// Figma Plugin API version 1
// This plugin implements a time tracking feature for Figma files

// Constants for timer management
const FILE_CHECK_INTERVAL = 1000; // How often to check for file changes (in ms)
const ACTIVITY_CHECK_INTERVAL = 5000; // How often to check for activity (in ms)
const SAVE_INTERVAL = 60000; // How often to save to local storage (in ms)
const INACTIVE_THRESHOLD = 5000; // Consider user inactive after this time (in ms)

// Storage keys
const SUMMARY_STORAGE_KEY = 'timeTrackingSummary';
const LAST_UPDATE_KEY = 'lastSummaryUpdate';
const BACKGROUND_TRACKING_KEY = 'backgroundTracking';

// Global variables
let isTracking = false;
let isUiVisible = false;
let backgroundTracking = true;
let activeFileId = '';
let activePage = '';
let activeFileName = '';
let activePageName = '';
let lastActivityTime = Date.now();
let lastSaveTime = Date.now();
let fileCheckInterval: number;
let activityCheckInterval: number;
let saveInterval: number;
let files: { [fileId: string]: any } = {};
let trackingStartTime = 0;

// Plugin initialization
figma.showUI(__html__, { width: 300, height: 400 });

// Register the plugin close handler
figma.on('close', async () => {
  console.log('Plugin closing, saving final data...');
  if (isTracking) {
    await stopTracking();
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

// Handle messages from the UI
figma.ui.onmessage = async (message: any) => {
  const pluginMessage = message as {type: string, [key: string]: any};
  console.log('Message received from UI:', pluginMessage.type);

  if (pluginMessage.type === 'ui-loaded') {
    // Load and send current tracking status
    await loadSummaryFromClientStorage();
    updateTrackingStatus();
    
    // Send summary data
    figma.ui.postMessage({
      type: 'summary-data',
      data: files
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
    console.log('Summary data requested from UI');
    figma.ui.postMessage({
      type: 'summary-data',
      data: files
    });
  }
};

// Initialize plugin
async function initializePlugin() {
  console.log('Initializing plugin');
  
  // Load summary from client storage
  const storedData = await loadSummaryFromClientStorage();
  if (storedData) {
    files = storedData;
    console.log('Loaded files from storage:', Object.keys(files));
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
  
  // Check current file immediately
  checkCurrentFile();
  
  // Send initial data to UI
  figma.ui.postMessage({
    type: 'summary-data',
    data: files
  });
}

// Handle user activity
function handleActivity() {
  lastActivityTime = Date.now();
  
  if (!isTracking) {
    startTracking();
  }
}

// Start time tracking
function startTracking() {
  if (isTracking) return;
  
  isTracking = true;
  console.log('Started tracking for file:', activeFileId);
  
  // Create new file entry if it doesn't exist
  if (!files[activeFileId]) {
    files[activeFileId] = {
      id: activeFileId,
      name: activeFileName,
      pages: {},
      totalTime: 0,
      lastUpdated: Date.now()
    };
    console.log('Created new file entry:', activeFileName);
  }
  
  // Create new page entry if it doesn't exist
  const pageKey = `${activeFileId}_${activePage}`;
  if (!files[activeFileId].pages[pageKey]) {
    files[activeFileId].pages[pageKey] = {
      id: activePage,
      name: activePageName,
      totalTime: 0,
      fileId: activeFileId,
      lastUpdated: Date.now()
    };
    console.log('Created new page entry:', activePageName);
  }
  
  trackingStartTime = Date.now();
  updateTrackingStatus();
  saveData();
}

// Stop time tracking
async function stopTracking() {
  if (!isTracking) return;
  
  isTracking = false;
  const endTime = Date.now();
  const duration = endTime - trackingStartTime;
  
  // Update tracking data
  if (activeFileId && files[activeFileId]) {
    const file = files[activeFileId];
    file.totalTime = (file.totalTime || 0) + duration;
    file.lastUpdated = Date.now();
    
    const pageKey = `${activeFileId}_${activePage}`;
    if (activePage && file.pages && file.pages[pageKey]) {
      const page = file.pages[pageKey];
      page.totalTime = (page.totalTime || 0) + duration;
      page.lastUpdated = Date.now();
    }
    
    // Save to client storage
    await saveSummaryToClientStorage(files);
    
    // Send updated summary to UI
    figma.ui.postMessage({
      type: 'summary-data',
      data: files,
      currentFileId: activeFileId
    });
  }
  
  // Update UI
  figma.ui.postMessage({ 
    type: 'tracking-status', 
    isTracking: false 
  });
  
  console.log('Stopped tracking. Updated file:', activeFileName);
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
    pageId: activePage
  });
}

// Check if the current file has changed
function checkCurrentFile() {
  try {
    const currentFileId = figma.currentPage.parent.id;
    const currentPageId = figma.currentPage.id;
    const currentFileName = (figma.currentPage.parent as any).name;
    const currentPageName = figma.currentPage.name;
    
    if (currentFileId !== activeFileId || currentPageId !== activePage) {
      handleFileChange(currentFileId, currentPageId, currentFileName, currentPageName);
    }
  } catch (error) {
    console.error('Error checking current file:', error);
  }
}

// Handle file or page change
async function handleFileChange(newFileId, newPageId, newFileName, newPageName) {
  console.log(`File/page changed: ${activeFileId}/${activePage} -> ${newFileId}/${newPageId}`);
  
  if (isTracking) {
    await stopTracking();
  }
  
  activeFileId = newFileId;
  activePage = newPageId;
  activeFileName = newFileName;
  activePageName = newPageName;
  
  // Ensure file exists in storage
  if (!files[activeFileId]) {
    files[activeFileId] = {
      id: activeFileId,
      name: activeFileName,
      pages: {},
      totalTime: 0,
      lastUpdated: Date.now()
    };
    console.log('Created new file entry on change:', activeFileName);
  }
  
  // Ensure page exists in file with unique key
  const pageKey = `${activeFileId}_${activePage}`;
  if (!files[activeFileId].pages[pageKey]) {
    files[activeFileId].pages[pageKey] = {
      id: activePage,
      name: activePageName,
      totalTime: 0,
      fileId: activeFileId,
      lastUpdated: Date.now()
    };
    console.log('Created new page entry on change:', activePageName);
  }
  
  // Save the new entries
  await saveSummaryToClientStorage(files);
  
  // Update UI with file change
  figma.ui.postMessage({
    type: 'file-changed',
    fileId: activeFileId,
    fileName: activeFileName,
    pageId: activePage,
    pageName: activePageName,
    resetTimer: true
  });
  
  // Send updated summary data
  figma.ui.postMessage({
    type: 'summary-data',
    data: files,
    currentFileId: activeFileId
  });
  
  if (backgroundTracking || isUiVisible) {
    startTracking();
  }
}

// Check for user activity
function checkActivity() {
  const now = Date.now();
  
  if (isTracking && (now - lastActivityTime > INACTIVE_THRESHOLD)) {
    console.log('User inactive, stopping tracking');
    stopTracking();
  }
}

// Save data to client storage
async function saveData() {
  try {
    await saveSummaryToClientStorage(files);
    lastSaveTime = Date.now();
  } catch (error) {
    console.error('Error saving data:', error);
  }
}

// Client storage functions
async function saveSummaryToClientStorage(summaryData: any) {
  try {
    await figma.clientStorage.setAsync(SUMMARY_STORAGE_KEY, summaryData);
    await figma.clientStorage.setAsync(LAST_UPDATE_KEY, Date.now());
    console.log('Summary saved to client storage. Files:', Object.keys(summaryData));
  } catch (error) {
    console.error('Error saving to client storage:', error);
  }
}

async function loadSummaryFromClientStorage() {
  try {
    const summaryData = await figma.clientStorage.getAsync(SUMMARY_STORAGE_KEY);
    const lastUpdate = await figma.clientStorage.getAsync(LAST_UPDATE_KEY);
    console.log('Summary loaded from client storage, files:', summaryData ? Object.keys(summaryData) : 'none');
    return summaryData || {};
  } catch (error) {
    console.error('Error loading from client storage:', error);
    return {};
  }
}
