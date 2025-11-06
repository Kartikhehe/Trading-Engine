// src/index.js
const app = require('./app');
const webSocketService = require('./core/WebSocketService'); // Import our service

const PORT = process.env.PORT || 3000;

// app.listen() returns the http.Server instance
const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// Attach the WebSocket service to the running HTTP server
webSocketService.attach(server);