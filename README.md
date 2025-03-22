# Figma Time Tracking Plugin

A Figma plugin for tracking time spent on design projects. The plugin allows designers to track their work time across various projects and stores the data in Firebase Realtime Database.

## Features

- Start and stop time tracking for specific projects
- Automatically calculate time spent on each project
- View recent time entries
- Add custom projects
- Data persists between sessions
- Firebase Realtime Database integration

## Technical Architecture

The plugin consists of three main components:

1. **UI Layer** (ui.html): A simple interface for interacting with the time tracking functionality
2. **Plugin Logic** (code.ts): Handles communication between the UI and Firebase
3. **Firebase Integration** (firebase-config.ts): Manages all interactions with Firebase Realtime Database

### Data Structure

Time tracking data is stored in Firebase with the following structure:

```
users: {
  "userID": {
    "projectID_1": [
      {
        "startTime": timestamp,
        "endTime": timestamp,
        "duration": seconds
      },
      ...
    ],
    "projectID_2": [
      ...
    ]
  }
}
```

## Installation & Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Build the plugin:
   ```
   npm run build
   ```

3. Load the plugin in Figma:
   - Open Figma
   - Go to Plugins > Development > Import plugin from manifest
   - Select the manifest.json file in this project

## Usage

1. Open the plugin in Figma
2. Select a project from the dropdown or add a new project
3. Click "Start" to begin tracking time
4. Click "Stop" when you're done
5. View your recent time entries at the bottom of the plugin

## Development

- Run `npm run watch` for continuous compilation during development
- Run `npm run lint` to check for code issues
- Run `npm run lint:fix` to automatically fix linting issues

## Firebase Configuration

The plugin uses the following Firebase configuration:
```
apiKey: "AIzaSyC5tcWk3ktDq8xd6fRXdNMupK9XPUTNpng",
authDomain: "figma-time-track.firebaseapp.com",
databaseURL: "https://figma-time-track-default-rtdb.asia-southeast1.firebasedatabase.app",
projectId: "figma-time-track",
storageBucket: "figma-time-track.firebasestorage.app",
messagingSenderId: "747870447856",
appId: "1:747870447856:web:e3f0151714603c51c1fa35",
measurementId: "G-NVQL6S7K99"
```

Below are the steps to get your plugin running. You can also find instructions at:

  https://www.figma.com/plugin-docs/plugin-quickstart-guide/

This plugin template uses Typescript and NPM, two standard tools in creating JavaScript applications.

First, download Node.js which comes with NPM. This will allow you to install TypeScript and other
libraries. You can find the download link here:

  https://nodejs.org/en/download/

Next, install TypeScript using the command:

  npm install -g typescript

Finally, in the directory of your plugin, get the latest type definitions for the plugin API by running:

  npm install --save-dev @figma/plugin-typings

If you are familiar with JavaScript, TypeScript will look very familiar. In fact, valid JavaScript code
is already valid Typescript code.

TypeScript adds type annotations to variables. This allows code editors such as Visual Studio Code
to provide information about the Figma API while you are writing code, as well as help catch bugs
you previously didn't notice.

For more information, visit https://www.typescriptlang.org/

Using TypeScript requires a compiler to convert TypeScript (code.ts) into JavaScript (code.js)
for the browser to run.

We recommend writing TypeScript code using Visual Studio code:

1. Download Visual Studio Code if you haven't already: https://code.visualstudio.com/.
2. Open this directory in Visual Studio Code.
3. Compile TypeScript to JavaScript: Run the "Terminal > Run Build Task..." menu item,
    then select "npm: watch". You will have to do this again every time
    you reopen Visual Studio Code.

That's it! Visual Studio Code will regenerate the JavaScript file every time you save.
