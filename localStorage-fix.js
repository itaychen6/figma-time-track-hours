// Fix for loadSummaryFromLocalStorage not being defined
if (typeof loadSummaryFromLocalStorage !== 'function') {
  window.loadSummaryFromLocalStorage = function() {
    console.log('Loading summary data from localStorage fallback');
    
    try {
      // Try to get data from localStorage
      const backupData = localStorage.getItem('figmaTimeTrackSummary_backup');
      
      if (!backupData) {
        console.log('No summary data found in localStorage');
        return null;
      }
      
      // Parse the data
      const savedData = JSON.parse(backupData);
      
      if (!savedData || Object.keys(savedData).length === 0) {
        console.log('Empty data in localStorage');
        return null;
      }
      
      console.log('Successfully loaded summary data from localStorage');
      return savedData;
    } catch (error) {
      console.error('Error loading summary from localStorage:', error);
      return null;
    }
  };
} 