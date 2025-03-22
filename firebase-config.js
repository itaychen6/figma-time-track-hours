// Firebase configuration file for the Figma Time Tracking plugin
import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, push, onValue } from "firebase/database";
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
// Initialize Firebase
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);
// Time tracking functions
export class TimeTracker {
    constructor(userId) {
        this.activeTimeEntry = null;
        this.userId = userId;
        this.userRef = ref(database, `users/${userId}`);
    }
    // Start time tracking for a project
    startTracking(projectId) {
        try {
            // If there's an active time entry, stop it first
            if (this.activeTimeEntry) {
                return this.stopTracking().then(() => this.startNewTracking(projectId));
            }
            else {
                return this.startNewTracking(projectId);
            }
        }
        catch (error) {
            console.error("Error starting time tracking:", error);
            return Promise.reject(error);
        }
    }
    // Helper method to start a new time tracking session
    startNewTracking(projectId) {
        this.activeTimeEntry = {
            startTime: Date.now(),
            project: projectId
        };
        // We don't save to Firebase immediately when starting to track
        // Only save when stopping or explicitly saving
        return Promise.resolve();
    }
    // Stop time tracking and save to Firebase
    stopTracking() {
        if (!this.activeTimeEntry) {
            console.warn("No active time entry to stop");
            return Promise.resolve();
        }
        try {
            const now = Date.now();
            const endTime = now;
            const duration = Math.round((endTime - this.activeTimeEntry.startTime) / 1000); // duration in seconds
            // Complete the active time entry
            const timeEntry = Object.assign(Object.assign({}, this.activeTimeEntry), { endTime,
                duration });
            // Save to Firebase
            return this.saveTimeEntry(timeEntry).then(() => {
                this.activeTimeEntry = null;
            });
        }
        catch (error) {
            console.error("Error stopping time tracking:", error);
            return Promise.reject(error);
        }
    }
    // Save time entry to Firebase
    saveTimeEntry(timeEntry) {
        try {
            const projectRef = ref(database, `users/${this.userId}/${timeEntry.project}`);
            const newEntryRef = push(projectRef);
            return set(newEntryRef, {
                startTime: timeEntry.startTime,
                endTime: timeEntry.endTime,
                duration: timeEntry.duration
            });
        }
        catch (error) {
            console.error("Error saving time entry:", error);
            return Promise.reject(error);
        }
    }
    // Get all time entries for the user
    getTimeEntries(callback) {
        try {
            onValue(this.userRef, (snapshot) => {
                const data = snapshot.val();
                callback(data);
            }, (error) => {
                console.error("Error getting time entries:", error);
            });
        }
        catch (error) {
            console.error("Error setting up time entries listener:", error);
        }
    }
    // Get time entries for a specific project
    getProjectTimeEntries(projectId, callback) {
        try {
            const projectRef = ref(database, `users/${this.userId}/${projectId}`);
            onValue(projectRef, (snapshot) => {
                const data = snapshot.val();
                callback(data);
            }, (error) => {
                console.error(`Error getting time entries for project ${projectId}:`, error);
            });
        }
        catch (error) {
            console.error(`Error setting up project time entries listener:`, error);
        }
    }
    // Check if there's an active time tracking session
    isTracking() {
        return this.activeTimeEntry !== null;
    }
    // Get the active time entry
    getActiveTimeEntry() {
        return this.activeTimeEntry;
    }
}
export { database };
