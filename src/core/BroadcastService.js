// src/core/BroadcastService.js
const wsService = require('./WebSocketService');
const { engine } = require('./MatchingEngine'); // To get the order book

class BroadcastService {

  /**
   * Broadcasts all new trades.
   * @param {Array<Object>} trades - An array of trade objects.
   */
  broadcastTrades(trades) {
    if (!trades || trades.length === 0) return;

    wsService.broadcast({
      type: 'trades',
      payload: trades,
    });
  }

  /**
   * Broadcasts all updated orders (new, partial, filled, cancelled).
   * @param {Array<Object>} orders - An array of order objects.
   */
  broadcastOrderUpdates(orders) {
    if (!orders || orders.length === 0) return;

    wsService.broadcast({
      type: 'orders',
      payload: orders,
    });
  }

  /**
   * Broadcasts the current state of the order book.
   * @param {string} instrument 
   */
  broadcastOrderBook(instrument = 'BTC-USD') {
    // Get the formatted, aggregated order book from the engine
    const orderBook = engine.getOrderBook(instrument);

    wsService.broadcast({
      type: 'orderbook',
      instrument: instrument,
      payload: orderBook,
    });
  }
}

module.exports = new BroadcastService();