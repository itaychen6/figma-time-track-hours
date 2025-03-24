// Figma Plugin API version 1
// This plugin implements a time tracking feature for Figma files

// Constants
const INTERVALS = {
  FILE_CHECK: 1000,    // How often to check for file changes (in ms)
  ACTIVITY_CHECK: 5000, // How often to check for activity (in ms)
  SAVE: 60000,         // How often to save to local storage (in ms)
  NOTIFICATION: 1800000,// Show notification every 30 minutes
  BACKGROUND_SAVE: 60000// Save data every minute in background
};

const THRESHOLDS = {
  INACTIVE: 5000       // Consider user inactive after this time (in ms)
};

const STORAGE_KEYS = {
  SUMMARY: 'timeTrackingSummary',
  LAST_UPDATE: 'lastSummaryUpdate',
  BACKGROUND_TRACKING: 'backgroundTracking'
};

// Types
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

// State management
class TimeTracker {
  public isTracking: boolean = false;
  public isUiVisible: boolean = false;
  private backgroundTracking: boolean = true;
  private activeFileId: string = '';
  private activePage: string = '';
  private activeFileName: string = '';
  private activePageName: string = '';
  private lastActivityTime: number = Date.now();
  private lastSaveTime: number = Date.now();
  public trackingStartTime: number = 0;
  private files: Files = {};
  private intervals: { [key: string]: number } = {};

  constructor() {
    this.initializePlugin();
  }

  // Plugin initialization
  private async initializePlugin() {
    console.log('Initializing plugin');
    await this.loadSummaryFromClientStorage();
    await this.loadBackgroundTrackingPreference();
    this.setupIntervals();
    this.checkCurrentFile();
  }

  private setupIntervals() {
    this.intervals = {
      fileCheck: setInterval(() => this.checkCurrentFile(), INTERVALS.FILE_CHECK),
      activityCheck: setInterval(() => this.checkActivity(), INTERVALS.ACTIVITY_CHECK),
      save: setInterval(() => this.saveData(), INTERVALS.SAVE)
    };
  }

  // Activity tracking
  public handleActivity() {
    this.lastActivityTime = Date.now();
    if (!this.isTracking) {
      this.startTracking();
    }
  }

  private async startTracking() {
    if (this.isTracking) return;
    
    this.isTracking = true;
    console.log('Started tracking');
    
    this.ensureFileAndPageExist();
    this.trackingStartTime = Date.now();
    
    if (!this.isUiVisible) {
      figma.notify('Started tracking time in background');
    }
    
    this.updateTrackingStatus();
    await this.saveData();
  }

  public async stopTracking() {
    if (!this.isTracking) return;
    
    this.isTracking = false;
    const duration = Date.now() - this.trackingStartTime;
    
    await this.updateTrackingData(duration);
    
    if (this.isUiVisible) {
      this.sendUiUpdates();
    } else {
      const timeString = this.formatDuration(Math.floor(duration / 1000));
      figma.notify(`Stopped tracking. Session duration: ${timeString}`);
    }
    
    console.log('Stopped tracking');
  }

  // File and page management
  private ensureFileAndPageExist() {
    if (!this.files[this.activeFileId]) {
      this.files[this.activeFileId] = {
        id: this.activeFileId,
        name: this.activeFileName,
        pages: {},
        totalTime: 0,
        lastUpdated: Date.now()
      };
    }

    if (!this.files[this.activeFileId].pages[this.activePage]) {
      this.files[this.activeFileId].pages[this.activePage] = {
        id: this.activePage,
        name: this.activePageName,
        totalTime: 0,
        fileId: this.activeFileId,
        lastUpdated: Date.now()
      };
    }
  }

  private async updateTrackingData(duration: number) {
    if (this.activeFileId && this.files[this.activeFileId]) {
      const file = this.files[this.activeFileId];
      file.totalTime = (file.totalTime || 0) + duration;
      file.lastUpdated = Date.now();
      
      if (this.activePage && file.pages[this.activePage]) {
        const page = file.pages[this.activePage];
        page.totalTime = (page.totalTime || 0) + duration;
        page.lastUpdated = Date.now();
        page.fileId = this.activeFileId;
      }
      
      this.cleanupOrphanedPages(file);
      await this.saveSummaryToClientStorage();
    }
  }

  private cleanupOrphanedPages(file: FileData) {
    Object.values(file.pages).forEach((page: PageData) => {
      if (!page.fileId || page.fileId !== this.activeFileId) {
        delete file.pages[page.id];
      }
    });
  }

  // UI communication
  public updateTrackingStatus() {
    if (!this.isUiVisible) return;
    
    figma.ui.postMessage({
      type: 'tracking-status',
      isTracking: this.isTracking,
      backgroundTracking: this.backgroundTracking,
      fileName: this.activeFileName,
      pageName: this.activePageName,
      startTime: this.isTracking ? this.trackingStartTime : null,
      fileId: this.activeFileId,
      pageId: this.activePage
    });
  }

  public sendUiUpdates() {
    figma.ui.postMessage({
      type: 'summary-data',
      data: this.files,
      currentFileId: this.activeFileId
    });
    
    figma.ui.postMessage({ 
      type: 'tracking-status', 
      isTracking: false 
    });
  }

  // Storage management
  private async saveData() {
    try {
      await this.saveSummaryToClientStorage();
      this.lastSaveTime = Date.now();
    } catch (error) {
      console.error('Error saving data:', error);
    }
  }

  private async saveSummaryToClientStorage() {
    try {
      await figma.clientStorage.setAsync(STORAGE_KEYS.SUMMARY, this.files);
      await figma.clientStorage.setAsync(STORAGE_KEYS.LAST_UPDATE, Date.now());
      console.log('Summary saved to client storage');
    } catch (error) {
      console.error('Error saving to client storage:', error);
    }
  }

  public async loadSummaryFromClientStorage() {
    try {
      const summaryData = await figma.clientStorage.getAsync(STORAGE_KEYS.SUMMARY);
      const lastUpdate = await figma.clientStorage.getAsync(STORAGE_KEYS.LAST_UPDATE);
      console.log('Summary loaded from client storage, last updated:', new Date(lastUpdate));
      if (summaryData) {
        this.files = summaryData;
      }
    } catch (error) {
      console.error('Error loading from client storage:', error);
    }
  }

  private async loadBackgroundTrackingPreference() {
    const bgTracking = await figma.clientStorage.getAsync(STORAGE_KEYS.BACKGROUND_TRACKING);
    if (bgTracking !== null) {
      this.backgroundTracking = bgTracking;
    }
  }

  // Utility functions
  public formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }

  public checkCurrentFile() {
    try {
      const currentFileId = figma.currentPage.parent.id;
      const currentPageId = figma.currentPage.id;
      const currentFileName = (figma.currentPage.parent as any).name;
      const currentPageName = figma.currentPage.name;
      
      if (currentFileId !== this.activeFileId || currentPageId !== this.activePage) {
        this.handleFileChange(currentFileId, currentPageId, currentFileName, currentPageName);
      }
    } catch (error) {
      console.error('Error checking current file:', error);
    }
  }

  public checkActivity() {
    const now = Date.now();
    
    if (this.isTracking && (now - this.lastActivityTime > THRESHOLDS.INACTIVE)) {
      console.log('User inactive, stopping tracking');
      if (!this.isUiVisible) {
        figma.notify('Stopping tracking due to inactivity');
      }
      this.stopTracking();
    }
  }

  private handleFileChange(fileId: string, pageId: string, fileName: string, pageName: string) {
    this.activeFileId = fileId;
    this.activePage = pageId;
    this.activeFileName = fileName;
    this.activePageName = pageName;
  }
}

// Initialize plugin
figma.showUI(__html__, { width: 300, height: 400 });
const tracker = new TimeTracker();

// Event handlers
figma.on('close', () => {
  console.log('Plugin UI closing, continuing in background...');
  tracker.isUiVisible = false;
  
  if (tracker.isTracking) {
    figma.notify('Time tracking continues in background. Open plugin to stop.');
    setInterval(() => {
      if (tracker.isTracking) {
        const elapsed = Math.floor((Date.now() - tracker.trackingStartTime) / 1000);
        figma.notify(`Still tracking time: ${tracker.formatDuration(elapsed)}`);
      }
    }, INTERVALS.NOTIFICATION);
  }
});

figma.on('run', () => {
  tracker.isUiVisible = true;
  tracker.updateTrackingStatus();
});

// Message handling
figma.ui.onmessage = async (message: any) => {
  const { type, ...data } = message;
  console.log('Message received from UI:', type);

  switch (type) {
    case 'resize':
      figma.ui.resize(300, data.height);
      break;
    case 'ui-loaded':
      await tracker.loadSummaryFromClientStorage();
      tracker.updateTrackingStatus();
      tracker.sendUiUpdates();
      break;
    case 'stop-tracking':
      await tracker.stopTracking();
      break;
    case 'start-tracking':
      tracker.handleActivity();
      break;
    case 'get-summary':
      tracker.sendUiUpdates();
      break;
  }
};
