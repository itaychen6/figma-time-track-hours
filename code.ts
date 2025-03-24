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

// Add these constants at the top of the file
const SUMMARY_STORAGE_KEY = 'timeTrackingSummary';
const LAST_UPDATE_KEY = 'lastSummaryUpdate';

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
interface FirebaseInitCompleteMessage { type: 'firebase-init-complete'; userId?: string; }
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
let pendingFirebaseDataRequest = false;
let trackingStartTime = 0;

// Plugin initialization
figma.showUI(__html__, { width: 300, height: 460 });

// Register the plugin close handler
figma.on('close', () => {
  console.log('Plugin closing, saving final data to Firebase...');
  
  // Save the detailed tracking data first
  saveTrackingDataToFirebase().then(() => {
    console.log('Tracking data saved to Firebase before closing');
    
    // Then explicitly save summary data to ensure it persists
    return saveDataToFirebase(true);
  }).then(() => {
    console.log('Summary data successfully saved to Firebase before closing');
  }).catch(error => {
    console.error('Error saving data to Firebase on close:', error);
  });
});

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
  
  // Start the plugin after a short delay to ensure UI is ready
  setTimeout(initializePlugin, 100);
}).catch(error => {
  console.error('Error loading all pages:', error);
  
  // Still try to initialize the plugin even if page loading fails
  setTimeout(initializePlugin, 100);
});

// Handle messages from the UI
figma.ui.onmessage = (message: any) => {
  const pluginMessage = message as {type: string, [key: string]: any};
  console.log('Message received from UI:', pluginMessage.type);

  if (pluginMessage.type === 'ui-loaded') {
    console.log('UI loaded, sending initial Firebase config and data');
    
    // Always send the Firebase config on startup
    figma.ui.postMessage({
      type: 'firebase-config',
      config: firebaseConfig,
      userId: userId
    });
    
    // Send current tracking status
    updateTrackingStatus();
    
    // Automatically send summary data whenever UI loads
    setTimeout(() => {
      sendSummaryData(true);
    }, 500);
  }
  else if (pluginMessage.type === 'reinitialize-firebase') {
    console.log('Reinitializing Firebase connection...');
    
    // Re-send the Firebase config
    figma.ui.postMessage({
      type: 'firebase-config',
      config: firebaseConfig,
      userId: userId
    });
  }
  else if (pluginMessage.type === 'sync-to-firebase') {
    // Force save all data to Firebase
    console.log('Manual Firebase sync requested');
    
    if (firebaseInitialized && userId) {
      saveTrackingDataToFirebase()
        .then(() => {
          console.log('Manual Firebase sync completed');
          
          // Also send summary data when manual sync is completed
          return saveDataToFirebase(true);
        })
        .then(() => {
          // Refresh the UI with latest data
          sendSummaryData(true);
        })
        .catch(error => {
          console.error('Error during manual Firebase sync:', error);
        });
    } else {
      console.warn('Cannot sync to Firebase - not initialized');
    }
  }
  else if (pluginMessage.type === 'stop-tracking') {
    console.log('Stop tracking requested from UI');
    if (isTracking) {
      stopTracking();
    }
  }
  else if (pluginMessage.type === 'start-tracking') {
    console.log('Start tracking requested from UI');
    handleActivity(); // This will start tracking if not already tracking
  }
  else if (pluginMessage.type === 'get-summary') {
    console.log('Summary data requested from UI');
    // Generate and send summary data directly to UI
    sendSummaryData(pluginMessage.immediate || false);
  }
  else if (pluginMessage.type === 'firebase-init-complete') {
    console.log('Firebase initialized, saving and sending summary data');
    firebaseInitialized = true;
    
    // Once Firebase is initialized, save summary data
    saveDataToFirebase(true).then(() => {
      // Also send updated summary to UI
      sendSummaryData(true);
    });
  }
};

// Start the plugin when UI sends ready message
async function initializePlugin() {
  console.log('Initializing plugin');
  
  // Load summary from client storage first
  const storedSummary = await loadSummaryFromClientStorage();
  if (storedSummary && Object.keys(storedSummary).length > 0) {
    files = storedSummary;
    console.log('Loaded summary from client storage');
  }
  
  // Set up message handlers with correct type
  figma.ui.onmessage = async (pluginMessage: any) => {
    if (pluginMessage.type === 'get-summary') {
      const summaryData = generateSummaryData();
      figma.ui.postMessage({ 
        type: 'summary-data',
        data: summaryData
      });
    }
    // ... rest of the message handlers ...
  };
  
  // Initialize Firebase
  await initializeFirebase();
  
  // Show UI
  figma.showUI(__html__, { width: 300, height: 400 });
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
    
    if (activePage && file.pages && file.pages[activePage]) {
      file.pages[activePage].totalTime = (file.pages[activePage].totalTime || 0) + duration;
    }
    
    // Save to client storage
    const summaryData = generateSummaryData();
    await saveSummaryToClientStorage(summaryData);
  }
  
  // Save to Firebase if available
  if (firebaseInitialized) {
    await saveDataToFirebase(true);
  }
  
  // Update UI
  figma.ui.postMessage({ 
    type: 'tracking-status', 
    isTracking: false 
  });
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

// Save data both locally and to Firebase
async function saveData(forceSyncToFirebase = false) {
  try {
    // Save to Firebase if it's time for sync or forced
    const now = Date.now();
    if (forceSyncToFirebase || !lastFirebaseSync || (now - lastFirebaseSync) > FIREBASE_SYNC_INTERVAL) {
      console.log('Saving data to Firebase (primary storage)');
      await saveDataToFirebase(true);
      lastFirebaseSync = now;
    }
    
    // Also save to client storage as backup
    await figma.clientStorage.setAsync('timeTrackingData', files);
    console.log('Saved data to client storage as backup');
    lastSaveTime = Date.now();
  } catch (error) {
    console.error('Error saving data:', error);
  }
}

// Save data to Firebase
async function saveDataToFirebase(forceSummarySync = false): Promise<void> {
  try {
    console.log('Saving data to Firebase');
    
    if (!firebaseInitialized) {
      console.warn('Firebase not initialized, cannot save');
      // Re-send Firebase config to try to initialize
      figma.ui.postMessage({
        type: 'firebase-config',
        config: firebaseConfig,
        userId: userId
      });
      return Promise.reject(new Error('Firebase not initialized'));
    }
    
    // Check if we have non-empty data to save
    if (!files || Object.keys(files).length === 0) {
      console.log('No data to save to Firebase');
      figma.ui.postMessage({
        type: 'firebase-status',
        status: 'No data to save'
      });
      return Promise.resolve(undefined);
    }
    
    // Always create summary data object for more reliable persistence
    const summaryData = {};
    
    // Build clean summary data
    Object.keys(files).forEach(fileId => {
      const file = files[fileId];
      if (file && (file.totalSeconds > 0 || file.totalTime > 0)) {
        summaryData[fileId] = {
          id: fileId,
          name: file.name,
          totalSeconds: Math.floor((file.totalTime || 0) / 1000) || file.totalSeconds || 0
        };
      }
    });
    
    return new Promise<void>((resolve, reject) => {
      // Set a timeout to ensure the operation doesn't hang indefinitely
      const timeoutId = setTimeout(() => {
        console.warn('Firebase save operation timed out');
        resolve(undefined); // Resolve anyway to avoid blocking the plugin
      }, 5000);
      
      // Send message to save both detailed tracking data and summary
      figma.ui.postMessage({
        type: 'save-to-firebase',
        files: files,
        summaryData: summaryData, // Always include summary data
        userId: userId,
        timestamp: Date.now(),
        forceSummarySync: true
      });
      
      // We can't wait for confirmation from the UI, so we resolve immediately
      // but leave the timeout in case there's an issue
      setTimeout(() => {
        clearTimeout(timeoutId);
        resolve(undefined);
      }, 300);
      
      // Update last sync time
      lastFirebaseSync = Date.now();
    });
    
  } catch (error) {
    console.error('Error saving to Firebase:', error);
    return Promise.reject(error);
  }
}

// Request data from Firebase
async function requestFirebaseData() {
  try {
    console.log('Requesting data from Firebase (primary data source)');
    
    if (!firebaseInitialized) {
      console.warn('Firebase not initialized, sending config first');
      figma.ui.postMessage({
        type: 'firebase-config',
        config: firebaseConfig,
        userId: userId
      });
      
      // Set a flag to indicate we want to fetch data when Firebase initializes
      pendingFirebaseDataRequest = true;
      
      // Try again after a short delay
      setTimeout(() => {
        if (firebaseInitialized) {
          console.log('Firebase now initialized, retrying data request');
          requestFirebaseData();
        } else {
          console.warn('Firebase still not initialized after delay, falling back');
          fallbackToClientStorage();
        }
      }, 5000);
      return;
    }
    
    // Request data from UI
    figma.ui.postMessage({
      type: 'load-from-firebase',
      userId: userId,
      priority: 'high' // Signal this is a primary data load
    });
  } catch (error) {
    console.error('Error requesting Firebase data:', error);
    fallbackToClientStorage();
  }
}

// Load plugin data
async function loadPluginData() {
  try {
    console.log('Loading plugin data, prioritizing Firebase...');
    
    // First check if Firebase is initialized
    if (firebaseInitialized) {
      console.log('Firebase initialized, requesting data from Firebase directly');
      requestFirebaseData();
      
      // Also request summary data explicitly
      sendSummaryData(true);
      return;
    }
    
    // If Firebase isn't initialized yet, initialize it and request later
    console.log('Firebase not initialized, sending config and will request data after initialization');
    figma.ui.postMessage({
      type: 'firebase-config',
      config: firebaseConfig,
      userId: userId
    });
    
    // We'll only use client storage as a fallback if Firebase fails
    console.log('Setting up Firebase initialization check interval');
    const checkInterval = setInterval(() => {
      if (firebaseInitialized) {
        clearInterval(checkInterval);
        console.log('Firebase now initialized, requesting data');
        requestFirebaseData();
        
        // Also request summary data explicitly
        sendSummaryData(true);
      }
    }, 500);
    
    // Set a timeout to fall back to client storage if Firebase doesn't initialize
    setTimeout(() => {
      if (!firebaseInitialized) {
        clearInterval(checkInterval);
        console.log('Firebase failed to initialize after timeout, falling back to client storage');
        // Only now try to load from client storage as a fallback
        fallbackToClientStorage();
      }
    }, 5000); // Wait 5 seconds for Firebase before falling back
  } catch (error) {
    console.error('Error in loadPluginData:', error);
    fallbackToClientStorage();
  }
}

// Fallback to client storage if Firebase fails
async function fallbackToClientStorage() {
  try {
    console.log('Falling back to client storage');
    const data = await figma.clientStorage.getAsync('timeTrackingData');
    
    if (data && Object.keys(data).length > 0) {
      console.log('Loaded data from client storage as fallback', data);
      files = data;
      sendAllFilesData();
      
      // Also send summary update with the loaded data
      figma.ui.postMessage({
        type: 'update-summary',
        files: files,
        userId: userId,
        immediate: true,
        source: 'clientStorage' // Flag the source for UI awareness
      });
    } else {
      console.log('No data in client storage either, starting fresh');
      files = {};
      sendAllFilesData();
      
      // Also init empty summary
      figma.ui.postMessage({
        type: 'update-summary',
        files: {},
        userId: userId,
        immediate: true
      });
    }
  } catch (error) {
    console.error('Error falling back to client storage:', error);
    files = {};
    sendAllFilesData();
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

// Save tracking data to Firebase with retry logic
async function saveTrackingDataToFirebase(): Promise<void> {
  if (!firebaseInitialized || !userId) {
    console.warn('Firebase not initialized, cannot save tracking data');
    return Promise.reject(new Error('Firebase not initialized'));
  }
  
  return new Promise((resolve, reject) => {
    // Set a timeout to ensure the operation completes
    const timeoutId = setTimeout(() => {
      console.warn('Firebase save operation timed out, may be incomplete');
      resolve(); // Resolve anyway to avoid blocking plugin close
    }, 3000);
    
    try {
      // Save data to Firebase through the UI
      figma.ui.postMessage({
        type: 'save-to-firebase',
        files: files,
        userId: userId,
        timestamp: Date.now()
      });
      
      // Resolve immediately since we can't wait for the UI to complete the save
      clearTimeout(timeoutId);
      resolve();
    } catch (error) {
      clearTimeout(timeoutId);
      console.error('Error initiating save to Firebase:', error);
      reject(error);
    }
  });
}

// Generate and send summary data to UI
function sendSummaryData(immediate: boolean = false) {
  console.log('Generating summary data for UI');
  
  try {
    // Create a clean summary data object
    const summaryData = {};
    
    // Only include files with tracking data
    Object.keys(files).forEach(fileId => {
      const file = files[fileId];
      if (file && (file.totalSeconds > 0 || file.totalTime > 0)) {
        // Create a clean file entry
        summaryData[fileId] = {
          id: fileId,
          name: file.name,
          totalSeconds: Math.floor((file.totalTime || 0) / 1000) || file.totalSeconds || 0
        };
      }
    });
    
    console.log('Sending summary data to UI', Object.keys(summaryData).length, 'files');
    
    // Send the data to UI
    figma.ui.postMessage({
      type: 'summary-data',
      data: summaryData,
      immediate: immediate,
      timestamp: Date.now()
    });
    
    // Also save this summary data to Firebase for persistence
    if (firebaseInitialized && userId) {
      saveDataToFirebase(true).catch(error => {
        console.error('Error saving summary data to Firebase after generating:', error);
      });
    }
    
  } catch (error) {
    console.error('Error generating summary data:', error);
    
    // Send error to UI
    figma.ui.postMessage({
      type: 'summary-error',
      error: error.message || 'Unknown error generating summary'
    });
  }
}

// Add these functions for client storage
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
    return summaryData || {};
  } catch (error) {
    console.error('Error loading from client storage:', error);
    return {};
  }
}

// Add the generateSummaryData function
function generateSummaryData() {
  const summary = {};
  
  // Generate summary for each file
  Object.keys(files).forEach(fileId => {
    const file = files[fileId];
    if (!file) return;
    
    summary[fileId] = {
      id: fileId,
      name: file.name,
      totalTime: file.totalTime || 0,
      pages: {}
    };
    
    // Add page data if it exists
    if (file.pages) {
      Object.keys(file.pages).forEach(pageId => {
        const page = file.pages[pageId];
        if (!page) return;
        
        summary[fileId].pages[pageId] = {
          id: pageId,
          name: page.name,
          totalTime: page.totalTime || 0
        };
      });
    }
  });
  
  return summary;
}

// Add the initializeFirebase function
async function initializeFirebase() {
  if (firebaseInitialized) return;
  
  try {
    // Get Firebase config from environment or constants
    const config = {
      // Your Firebase config here
    };
    
    // Initialize Firebase (implementation depends on your setup)
    firebaseInitialized = true;
    console.log('Firebase initialized');
  } catch (error) {
    console.error('Error initializing Firebase:', error);
  }
}
