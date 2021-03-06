const HotsDraftApp = require("./hots-draft-app.js");

// initialize core app class
let hotsApp = new HotsDraftApp();

// send incoming messages from the main process to the app
process.on("message", (message) => {
  hotsApp.handleEvent(...message);
});