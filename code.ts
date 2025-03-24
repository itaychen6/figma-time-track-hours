// Figma Plugin API version 1
// This plugin implements a time tracking feature for Figma files

// Constants for timer management
const FILE_CHECK_INTERVAL = 1000; // How often to check for file changes (in ms)
const ACTIVITY_CHECK_INTERVAL = 5000; // How often to check for activity (in ms)
const SAVE_INTERVAL = 60000; // How often to save to local storage (in ms)
const INACTIVE_THRESHOLD = 300000; // Consider user inactive after 5 minutes
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

interface TimeEntry {
  startTime: number;
  lastUpdate: number;
}

interface TrackingState {
  isTracking: boolean;
  currentFile: string | null;
  currentPage: string | null;
  lastActivity: number;
  activeSession: TimeEntry | null;
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

// Global state
let trackingState: TrackingState = {
  isTracking: false,
  currentFile: null,
  currentPage: null,
  lastActivity: Date.now(),
  activeSession: null
};

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

// Handle messages from the UI
figma.ui.onmessage = async (message: any) => {
  const pluginMessage = message as {type: string, [key: string]: any};
  console.log('Message received from UI:', pluginMessage.type);

  if (pluginMessage.type === 'resize') {
    // Resize the plugin window
    figma.ui.resize(300, pluginMessage.height);
  }
  else if (pluginMessage.type === 'ui-loaded') {
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
  
  // Load saved data
  try {
    const savedFiles = await figma.clientStorage.getAsync(SUMMARY_STORAGE_KEY);
    if (savedFiles && typeof savedFiles === 'object') {
      files = savedFiles;
    }
    
    // Load tracking state
    const savedState = await figma.clientStorage.getAsync('trackingState');
    if (savedState) {
      trackingState = {
        ...savedState,
        activeSession: null // Always start with no active session
      };
    }
  } catch (error) {
    console.error('Error loading saved data:', error);
  }
  
  // Set up initial state
  trackingState.currentFile = figma.fileKey;
  trackingState.currentPage = figma.currentPage.id;
  
  // Update UI with current state
  updateUI();
}

// Handle user activity
function handleActivity() {
  const now = Date.now();
  
  if (!trackingState.isTracking) {
    startTracking();
    return;
  }
  
  // Update last activity time
  trackingState.lastActivity = now;
  
  // Update session if exists
  if (trackingState.activeSession) {
    updateCurrentSession();
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
  const now = Date.now();
  
  trackingState.isTracking = true;
  trackingState.lastActivity = now;
  trackingState.activeSession = {
    startTime: now,
    lastUpdate: now
  };
  
  // Ensure current file/page exists in data structure
  ensurePageExists(figma.currentPage);
  
  // Update UI
  updateUI();
  
  figma.notify('Started tracking time', { timeout: 2000 });
}

// Stop time tracking
async function stopTracking() {
  if (!trackingState.isTracking) return;
  
  // Save final session time
  updateCurrentSession();
  
  trackingState.isTracking = false;
  trackingState.activeSession = null;
  
  // Save state
  await saveData();
  
  // Update UI
  updateUI();
  
  figma.notify('Stopped tracking time', { timeout: 2000 });
}

// Update UI with current tracking status
function updateTrackingStatus() {
  figma.ui.postMessage({
    type: 'tracking-status',
    isTracking: trackingState.isTracking,
    backgroundTracking: backgroundTracking,
    fileName: activeFileName,
    pageName: activePageName,
    startTime: trackingState.isTracking ? trackingStartTime : null,
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
    if (trackingState.isTracking) {
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
  if (trackingState.isTracking && isUiVisible && (now - trackingState.lastActivity > INACTIVE_THRESHOLD)) {
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
    trackingState.lastActivity = now;
    return true;
  }

  // Check if we're still within activity timeout
  return (now - trackingState.lastActivity) < RECENT_UPDATE_THRESHOLD;
}

// Save data to client storage
async function saveData() {
  try {
    await figma.clientStorage.setAsync(SUMMARY_STORAGE_KEY, files);
    await figma.clientStorage.setAsync('trackingState', {
      ...trackingState,
      activeSession: null // Don't save session details
    });
  } catch (error) {
    console.error('Error saving data:', error);
    figma.notify('Error saving tracking data', { error: true });
  }
}

// Client storage functions
async function loadSummaryFromClientStorage() {
  try {
    const summaryData = await figma.clientStorage.getAsync(SUMMARY_STORAGE_KEY);
    const lastUpdate = await figma.clientStorage.getAsync(LAST_UPDATE_KEY);
    console.log('Summary loaded from client storage, last updated:', new Date(lastUpdate));
    
    // Validate and clean the loaded data
    if (summaryData && typeof summaryData === 'object') {
      // Clean up any invalid entries
      Object.keys(summaryData).forEach(fileId => {
        const file = summaryData[fileId];
        if (!file || !file.pages || typeof file.pages !== 'object') {
          delete summaryData[fileId];
          return;
        }
        
        // Clean up invalid pages
        Object.keys(file.pages).forEach(pageId => {
          const page = file.pages[pageId];
          if (!page || !page.id || !page.name || typeof page.totalTime !== 'number') {
            delete file.pages[pageId];
          }
        });
        
        // Recalculate file total time
        file.totalTime = Object.values(file.pages).reduce((total, p: any) => total + (p.totalTime || 0), 0);
      });
      
      files = summaryData;
      
      // Send immediate update to UI
      if (isUiVisible) {
        figma.ui.postMessage({
          type: 'summary-data',
          data: files
        });
      }
    } else {
      console.log('No valid summary data found, initializing empty state');
      files = {};
    }
    
    return files;
  } catch (error) {
    console.error('Error loading from client storage:', error);
    files = {};
    return files;
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
      trackingState.lastActivity = now;
      
      // Handle auto-start tracking with immediate feedback
      if (!trackingState.isTracking && backgroundTracking) {
        if (!sustainedActivityStart) {
          sustainedActivityStart = now;
        } else if (now - sustainedActivityStart >= AUTO_START_THRESHOLD) {
          showBackgroundNotification('Activity detected, starting time tracking...', 3000);
          startTracking();
          sustainedActivityStart = 0;
          
          // Force an immediate time update
          updateCurrentSession();
          saveData();
        }
      }
    } else {
      sustainedActivityStart = 0;
    }
    
    // Update and save time more frequently in background
    if (trackingState.isTracking) {
      updateCurrentSession();
      
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
function updateCurrentSession() {
  if (!trackingState.isTracking || !activeFileId || !activePage) return;
  
  const now = Date.now();
  const elapsed = now - trackingState.lastActivity;
  
  // Only update if reasonable time has passed
  if (elapsed > 0 && elapsed < INACTIVE_THRESHOLD) {
    // Update page time
    const page = files[activeFileId]?.pages[activePage.id];
    if (page) {
      page.totalTime += elapsed;
      page.lastUpdated = now;
      
      // Update file total time
      files[activeFileId].totalTime = Object.values(files[activeFileId].pages).reduce((total, p) => total + (p.totalTime || 0), 0);
    }
  }
  
  // Update session
  trackingState.lastActivity = now;
  
  // Save periodically
  if (now - lastSaveTime >= SAVE_INTERVAL) {
    saveData();
  }
  
  // Update UI
  updateUI();
}

function ensurePageExists(page: PageNode) {
  const fileId = figma.fileKey;
  const fileName = figma.root.name;
  
  // Ensure file exists
  if (!files[fileId]) {
    files[fileId] = {
      id: fileId,
      name: fileName,
      pages: {},
      totalTime: 0,
      lastUpdated: Date.now()
    };
  }
  
  // Ensure page exists
  if (!files[fileId].pages[page.id]) {
    files[fileId].pages[page.id] = {
      id: page.id,
      name: page.name,
      totalTime: 0,
      fileId: fileId,
      lastUpdated: Date.now()
    };
  }
}

function updateUI() {
  figma.ui.postMessage({
    type: 'update',
    tracking: trackingState.isTracking,
    files: files,
    currentFile: trackingState.currentFile,
    currentPage: trackingState.currentPage,
    activeSession: trackingState.activeSession
  });
}
