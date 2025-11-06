// src/core/WebSocketService.js
const { WebSocketServer } = require('ws');

class WebSocketService {
  constructor() {
    this.wss = null;
    this.clients = new Set();
  }

  /**
   * Attaches the WebSocket server to an existing HTTP server.
   * @param {http.Server} server - The HTTP server instance from app.listen()
   */
  attach(server) {
    // We'll create the WebSocket server on the /stream path
    this.wss = new WebSocketServer({ server, path: '/stream' });

    this.wss.on('connection', (ws) => {
      console.log('Client connected to WebSocket stream');
      this.clients.add(ws);

      // Send a welcome message
      ws.send(JSON.stringify({ type: 'welcome', message: 'Connected to trade stream' }));

      ws.on('close', () => {
        console.log('Client disconnected');
        this.clients.delete(ws);
      });

      ws.on('error', (err) => {
        console.error('WebSocket error:', err);
        this.clients.delete(ws);
      });
    });

    console.log('WebSocketService attached to HTTP server on /stream');
  }

  /**
   * Sends a JSON-stringified message to every connected client.
   * @param {Object} message - The data object to send.
   */
  broadcast(message) {
    if (!this.wss) {
      console.warn('WebSocketService not attached, cannot broadcast.');
      return;
    }

    const payload = JSON.stringify(message);

    this.clients.forEach((client) => {
      if (client.readyState === 1) { // 1 === WebSocket.OPEN
        client.send(payload, (err) => {
          if (err) {
            console.error('Error sending to client, removing:', err);
            this.clients.delete(client);
          }
        });
      }
    });
  }
}

// Export a singleton instance
module.exports = new WebSocketService();