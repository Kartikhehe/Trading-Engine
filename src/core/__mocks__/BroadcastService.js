// src/core/__mocks__/BroadcastService.js
class MockBroadcastService {
    broadcastTrades() { /* do nothing */ }
    broadcastOrderUpdates() { /* do nothing */ }
    broadcastOrderBook() { /* do nothing */ }
  }
  module.exports = new MockBroadcastService();