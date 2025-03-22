// Figma Plugin API version 1
// This plugin implements a time tracking feature for Figma files

// Constants for timer management
const FILE_CHECK_INTERVAL = 1000; // How often to check for file changes (in ms)
const HEARTBEAT_INTERVAL = 5000; // How often to check if plugin is still active (in ms)
const ACTIVITY_CHECK_INTERVAL = 5000; // How often to check for activity (in ms)
const SAVE_INTERVAL = 60000; // How often to save to local storage (in ms)
const INACTIVE_THRESHOLD = 5000; // Consider user inactive after this time (in ms)
const FIREBASE_SYNC_INTERVAL = 300000; // Sync with Firebase every 5 minutes
const PLUGIN_REACTIVATION_DELAY = 500; // Delay before reactivating plugin (in ms)

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyC5tcWk3ktDq8xd6fRXdNMupK9XPUTNpng",
  authDomain: "figma-time-track.firebaseapp.com",
  databaseURL: "https://figma-time-track-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "figma-time-track",
  storageBucket: "figma-time-track.firebasestorage.app",
  messagingSenderId: "747870447856",
  appId: "1:747870447856:web:e3f0151714603c51c1fa35",
  measurementId: "G-NVQL6S7K99"
};

// ID generation function
function generateId() {
  return Math.random().toString(36).substring(2, 15);
}

// Generate or retrieve user ID
let userId = figma.clientStorage.getAsync('userId').then(id => {
  if (!id) {
    id = generateId();
    figma.clientStorage.setAsync('userId', id);
  }
  return id;
});

// Message types
interface ResizeMessage { type: 'resize'; width: number; height: number; }
interface LoadDataMessage { type: 'load-data'; }
interface StartTrackingMessage { type: 'start-tracking'; }
interface StopTrackingMessage { type: 'stop-tracking'; }
interface SaveTimeEntryMessage { type: 'save-time-entry'; entry: any; }
interface ToggleBackgroundTrackingMessage { type: 'toggle-background-tracking'; enabled: boolean; }
interface UiVisibilityChangedMessage { type: 'ui-visibility-changed'; isVisible: boolean; }
interface RequestFilesDataMessage { type: 'request-files-data'; }
interface GetSummaryMessage { type: 'get-summary'; immediate?: boolean; }
interface SyncToFirebaseMessage { type: 'sync-to-firebase'; }
interface SyncFromFirebaseMessage { type: 'sync-from-firebase'; }
interface FirebaseInitCompleteMessage { type: 'firebase-init-complete'; }
interface FirebaseDataLoadedMessage { type: 'firebase-data-loaded'; data: any; }
interface FirebaseErrorMessage { type: 'firebase-error'; error: string; }
interface UiLoadedMessage { type: 'ui-loaded'; }

type PluginMessage = 
  | ResizeMessage
  | LoadDataMessage
  | StartTrackingMessage
  | StopTrackingMessage
  | SaveTimeEntryMessage
  | ToggleBackgroundTrackingMessage
  | UiVisibilityChangedMessage
  | RequestFilesDataMessage
  | GetSummaryMessage
  | SyncToFirebaseMessage
  | SyncFromFirebaseMessage
  | FirebaseInitCompleteMessage
  | FirebaseDataLoadedMessage
  | FirebaseErrorMessage
  | UiLoadedMessage;

// Global variables
let isTracking = false;
let isUiVisible = false;
let backgroundTracking = true; // Start with background tracking enabled by default
let activeFileId = '';
let activePage = '';
let activeFileName = '';
let activePageName = '';
let lastActivityTime = Date.now();
let lastSaveTime = Date.now();
let lastFirebaseSync = 0; // Track last time we synced with Firebase
let fileCheckInterval: number;
let activityCheckInterval: number;
let saveInterval: number;
let heartbeatInterval: number;
let files: { [fileId: string]: any } = {};
let firebaseInitialized = false;
let pagesLoaded = false;

// Plugin initialization
figma.showUI(__html__, { width: 300, height: 460 });

// First, load all pages before registering event handlers
figma.loadAllPagesAsync().then(() => {
  pagesLoaded = true;
  
  // Register event handlers after pages are loaded
  figma.on('selectionchange', () => {
    handleActivity();
  });
  
  figma.on('documentchange', () => {
    handleActivity();
  });
  
  console.log('All pages loaded, event handlers registered');
}).catch(error => {
  console.error('Error loading all pages:', error);
});

// Focus the plugin window
figma.ui.onmessage = async (message: any) => {
  const pluginMessage = message as PluginMessage;
  console.log('Message received from UI:', pluginMessage.type);
  
  if (pluginMessage.type === 'resize') {
    figma.ui.resize(pluginMessage.width, pluginMessage.height);
  }
  
  else if (pluginMessage.type === 'load-data') {
    loadPluginData();
  }
  
  else if (pluginMessage.type === 'start-tracking') {
    startTracking();
  }
  
  else if (pluginMessage.type === 'stop-tracking') {
    stopTracking();
  }
  
  else if (pluginMessage.type === 'save-time-entry') {
    saveTimeEntry(pluginMessage.entry);
  }
  
  else if (pluginMessage.type === 'toggle-background-tracking') {
    backgroundTracking = pluginMessage.enabled;
    figma.clientStorage.setAsync('backgroundTracking', backgroundTracking);
    // If switching from background to foreground and current file isn't active
    if (!backgroundTracking && activeFileId !== figma.currentPage.parent.id) {
      stopTracking();
    }
    sendAllFilesData();
  }
  
  else if (pluginMessage.type === 'ui-visibility-changed') {
    isUiVisible = pluginMessage.isVisible;
    console.log(`UI visibility changed: ${isUiVisible}`);
    
    // If UI becomes visible, check activity and update
    if (isUiVisible) {
      handleActivity();
      updateTrackingStatus();
      sendAllFilesData();
    }
  }
  
  else if (pluginMessage.type === 'request-files-data') {
    sendAllFilesData();
  }
  
  else if (pluginMessage.type === 'get-summary') {
    // Send back all files data as summary
    figma.ui.postMessage({
      type: 'update-summary',
      files: files,
      userId: await userId,
      immediate: pluginMessage.immediate // Pass through the immediate flag
    });
  }
  
  else if (pluginMessage.type === 'sync-to-firebase') {
    saveDataToFirebase();
  }
  
  else if (pluginMessage.type === 'sync-from-firebase') {
    requestFirebaseData();
  }
  
  else if (pluginMessage.type === 'firebase-init-complete') {
    firebaseInitialized = true;
    console.log('Firebase initialized successfully');
    // Once Firebase is initialized, request data
    requestFirebaseData();
  }
  
  else if (pluginMessage.type === 'firebase-data-loaded') {
    if (pluginMessage.data && Object.keys(pluginMessage.data).length > 0) {
      console.log('Loaded data from Firebase');
      files = pluginMessage.data;
      sendAllFilesData();
    } else {
      console.log('No data found in Firebase, using local data');
    }
  }
  
  else if (pluginMessage.type === 'firebase-error') {
    console.error('Firebase error:', pluginMessage.error);
    // On Firebase error, fallback to local data
    loadLocalData();
  }
  
  else if (pluginMessage.type === 'ui-loaded') {
    console.log('UI reported as loaded, initializing plugin...');
    initializePlugin();
  }
};

// Start the plugin when UI sends ready message
function initializePlugin() {
  // Send Firebase config to UI immediately
  sendFirebaseConfig();
  
  // Set up file change checking
  fileCheckInterval = setInterval(checkCurrentFile, FILE_CHECK_INTERVAL);
  
  // Set up activity checking
  activityCheckInterval = setInterval(checkActivity, ACTIVITY_CHECK_INTERVAL);
  
  // Set up periodic saving
  saveInterval = setInterval(saveData, SAVE_INTERVAL);
  
  // Set up heartbeat to check if plugin is still active
  heartbeatInterval = setInterval(heartbeat, HEARTBEAT_INTERVAL);
  
  // Initial loading of saved data
  loadPluginData();
  
  // Check current file immediately
  checkCurrentFile();
  
  // Log initialization
  console.log('Plugin initialized');
  
  // Wait a bit to ensure UI is loaded before starting tracking
  setTimeout(() => {
    // Start tracking automatically when plugin loads
    console.log('Starting initial tracking...');
    handleActivity();
    
    // Explicitly update UI with tracking status and all files data after slight delay
    setTimeout(() => {
      sendAllFilesData();
      updateTrackingStatus();
      
      // Also send summary data immediately
      figma.ui.postMessage({
        type: 'update-summary',
        files: files,
        userId: userId,
        immediate: true
      });
      
      console.log('Sent initial tracking status and summary data to UI');
    }, 1000);
  }, PLUGIN_REACTIVATION_DELAY);
}

// Send Firebase configuration to UI
function sendFirebaseConfig() {
  figma.ui.postMessage({
    type: 'firebase-config',
    config: firebaseConfig
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
  console.log('Started tracking');
  
  // Create or update file entry
  if (!files[activeFileId]) {
    files[activeFileId] = {
      id: activeFileId,
      name: activeFileName,
      pages: {},
      totalSeconds: 0,
      lastTrackedTime: Date.now()
    };
  }
  
  // Create or update page entry
  if (!files[activeFileId].pages[activePage]) {
    files[activeFileId].pages[activePage] = {
      id: activePage,
      name: activePageName,
      entries: [],
      totalSeconds: 0
    };
  }
  
  // Add new time entry
  const newEntry = {
    id: generateId(),
    start: Date.now(),
    end: null,
    seconds: 0
  };
  
  files[activeFileId].pages[activePage].entries.push(newEntry);
  files[activeFileId].lastTrackedTime = Date.now();
  
  updateTrackingStatus();
  saveData();
}

// Stop time tracking
function stopTracking() {
  if (!isTracking) return;
  
  isTracking = false;
  console.log('Stopped tracking');
  
  // Update most recent time entry
  if (files[activeFileId] && 
      files[activeFileId].pages[activePage] && 
      files[activeFileId].pages[activePage].entries.length > 0) {
    
    const entries = files[activeFileId].pages[activePage].entries;
    const lastEntry = entries[entries.length - 1];
    
    if (lastEntry && !lastEntry.end) {
      lastEntry.end = Date.now();
      lastEntry.seconds = Math.floor((lastEntry.end - lastEntry.start) / 1000);
      
      // Update totals
      files[activeFileId].pages[activePage].totalSeconds += lastEntry.seconds;
      files[activeFileId].totalSeconds += lastEntry.seconds;
    }
  }
  
  updateTrackingStatus();
  saveData();
}

// Update UI with current tracking status
function updateTrackingStatus() {
  figma.ui.postMessage({
    type: 'tracking-status',
    isTracking: isTracking,
    backgroundTracking: backgroundTracking,
    fileName: activeFileName,
    pageName: activePageName
  });
}

// Check if the current file has changed
function checkCurrentFile() {
  try {
    // Get current file and page information
    const currentFileId = figma.currentPage.parent.id;
    const currentPageId = figma.currentPage.id;
    const currentFileName = (figma.currentPage.parent as any).name;
    const currentPageName = figma.currentPage.name;
    
    // Check for file or page change
    if (currentFileId !== activeFileId || currentPageId !== activePage) {
      handleFileChange(currentFileId, currentPageId, currentFileName, currentPageName);
    }
  } catch (error) {
    console.error('Error checking current file:', error);
  }
}

// Handle file or page change
function handleFileChange(newFileId, newPageId, newFileName, newPageName) {
  console.log(`File changed: ${activeFileId} -> ${newFileId}`);
  
  // Stop tracking in the previous file
  if (isTracking) {
    stopTracking();
  }
  
  // Update active file and page information
  activeFileId = newFileId;
  activePage = newPageId;
  activeFileName = newFileName;
  activePageName = newPageName;
  
  // Notify UI about file change
  figma.ui.postMessage({
    type: 'file-changed',
    fileId: activeFileId,
    fileName: activeFileName,
    pageId: activePage,
    pageName: activePageName,
    resetTimer: true  // Explicitly tell UI to reset timer
  });
  
  // Start tracking in the new file if appropriate
  // Only start if we're using background tracking or if the UI is visible
  if (backgroundTracking || isUiVisible) {
    startTracking();
  }
  
  // Update files list in UI
  sendAllFilesData();
}

// Check for user activity
function checkActivity() {
  const now = Date.now();
  
  // Check if user has been inactive
  if (isTracking && (now - lastActivityTime > INACTIVE_THRESHOLD)) {
    console.log('User inactive, stopping tracking');
    stopTracking();
  }
  
  // Handle various context loss scenarios
  const userHasContextLoss = checkForContextLoss();
  if (userHasContextLoss) {
    handleContextLoss();
  }
}

// Check for various context loss scenarios
function checkForContextLoss() {
  try {
    // Check if we can still access the Figma API properly
    const canAccessCurrentPage = !!figma.currentPage;
    const canAccessDocumentName = !!(figma.currentPage.parent as any).name;
    
    // If we can't access these basic properties, we have lost context
    return !canAccessCurrentPage || !canAccessDocumentName;
  } catch (error) {
    console.error('Context loss check error:', error);
    return true; // Assume context loss if there's an error
  }
}

// Handle context loss (user switched tabs, app, etc.)
function handleContextLoss() {
  console.log('Context loss detected');
  
  // If only tracking active file, stop tracking
  if (!backgroundTracking) {
    if (isTracking) {
      console.log('Stopping tracking due to context loss');
      stopTracking();
    }
  }
}

// Heartbeat to ensure plugin is working
function heartbeat() {
  console.log('Plugin heartbeat - active');
}

// Save all plugin data
function saveData() {
  lastSaveTime = Date.now();
  
  // Save to local storage
  figma.clientStorage.setAsync('files', files);
  figma.clientStorage.setAsync('backgroundTracking', backgroundTracking);
  
  // Sync to Firebase periodically
  if (Date.now() - lastFirebaseSync > FIREBASE_SYNC_INTERVAL) {
    saveDataToFirebase();
  }
  
  console.log('Saved plugin data');
}

// Save data to Firebase (through UI)
async function saveDataToFirebase() {
  console.log('Sending data to Firebase');
  
  if (!firebaseInitialized) {
    console.log('Firebase not initialized yet, retrying in 2 seconds...');
    setTimeout(saveDataToFirebase, 2000);
    return;
  }
  
  lastFirebaseSync = Date.now();
  
  figma.ui.postMessage({
    type: 'save-to-firebase',
    files: files,
    userId: await userId,
    timestamp: Date.now() // Add timestamp for tracking updates
  });
}

// Request data from Firebase
async function requestFirebaseData() {
  console.log('Requesting data from Firebase');
  
  if (!firebaseInitialized) {
    console.log('Firebase not initialized yet, retrying in 2 seconds...');
    setTimeout(requestFirebaseData, 2000);
    return;
  }
  
  figma.ui.postMessage({
    type: 'load-from-firebase',
    userId: await userId
  });
}

// Load plugin data
function loadPluginData() {
  console.log('Loading plugin data');
  
  // Start by loading local data
  loadLocalData();
  
  // Also request Firebase data if initialized
  if (firebaseInitialized) {
    requestFirebaseData();
  }
}

// Load data from local storage
function loadLocalData() {
  // Load files data
  figma.clientStorage.getAsync('files').then(savedFiles => {
    if (savedFiles) {
      files = savedFiles;
      sendAllFilesData();
      console.log('Loaded data from local storage');
    } else {
      console.log('No saved files data found in local storage');
    }
  }).catch(error => {
    console.error('Error loading files from local storage:', error);
  });
  
  // Load background tracking setting
  figma.clientStorage.getAsync('backgroundTracking').then(value => {
    if (value !== undefined) {
      backgroundTracking = value;
    } else {
      backgroundTracking = true; // Default to true if not set
    }
    updateTrackingStatus();
  }).catch(error => {
    console.error('Error loading background tracking setting:', error);
  });
}

// Save a specific time entry from UI
function saveTimeEntry(entry) {
  console.log('Saving time entry:', entry);
  
  try {
    // Find and update the entry
    if (files[entry.fileId] && 
        files[entry.fileId].pages[entry.pageId]) {
      
      const file = files[entry.fileId];
      const page = file.pages[entry.pageId];
      
      // Find the entry by ID
      const entryIndex = page.entries.findIndex(e => e.id === entry.id);
      if (entryIndex !== -1) {
        const oldSeconds = page.entries[entryIndex].seconds;
        const newSeconds = entry.seconds;
        const difference = newSeconds - oldSeconds;
        
        // Update the entry
        page.entries[entryIndex] = entry;
        
        // Update totals
        page.totalSeconds += difference;
        file.totalSeconds += difference;
        
        saveData();
        sendAllFilesData();
      }
    }
  } catch (error) {
    console.error('Error saving time entry:', error);
  }
}

// Send all files data to UI
function sendAllFilesData() {
  figma.ui.postMessage({
    type: 'files-updated',
    files: files,
    activeFileId: activeFileId,
    activePage: activePage
  });
}
