// Load summary data from localStorage as a fallback
function loadSummaryFromLocalStorage() {
  console.log('Loading summary data from localStorage fallback');
  
  try {
    // Try to get data from localStorage
    const storageKey = 'timeTrackingSummary_' + userId;
    const savedDataString = localStorage.getItem(storageKey);
    
    if (!savedDataString) {
      console.log('No summary data found in localStorage');
      return null;
    }
    
    // Parse the data
    const savedData = JSON.parse(savedDataString);
    
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
} 