// src/core/MatchingEngine.test.js
const { v4: uuidv4 } = require('uuid');
const { MatchingEngine } = require('./MatchingEngine');
const client = require('../redisClient');

// DO NOT use fake timers. We are testing a real database.

describe('MatchingEngine (Redis)', () => {
  let engine;

  beforeEach(async () => {
    // Clear the *entire* Redis database before each test
    await client.FLUSHDB();
    engine = new MatchingEngine();
  });

  // Test 1: Simple match
  test('should match a simple limit buy and limit sell', async () => {
    const buyOrder = { order_id: uuidv4(), instrument: 'BTC-USD', side: 'buy', type: 'limit', price: 100, quantity: 5, client_id: 'b1' };
    const sellOrder = { order_id: uuidv4(), instrument: 'BTC-USD', side: 'sell', type: 'limit', price: 100, quantity: 5, client_id: 's1' };

    await engine.placeOrder(buyOrder);
    const { trades, updatedOrders } = await engine.placeOrder(sellOrder);

    expect(trades).toHaveLength(1);
    expect(trades[0].quantity).toBe(5);

    expect(updatedOrders).toHaveLength(2);
    expect(updatedOrders.find(o => o.order_id === buyOrder.order_id).status).toBe('filled');
    expect(updatedOrders.find(o => o.order_id === sellOrder.order_id).status).toBe('filled');

    // Check the book
    const book = await engine.getOrderBook();
    expect(book.bids).toHaveLength(0);
    expect(book.asks).toHaveLength(0);
  });

  // Test 2: Partial fills
  test('should handle partial fills', async () => {
    const sellOrder = { order_id: uuidv4(), instrument: 'BTC-USD', side: 'sell', type: 'limit', price: 100, quantity: 10, client_id: 's1' };
    await engine.placeOrder(sellOrder);

    const buyOrder = { order_id: uuidv4(), instrument: 'BTC-USD', side: 'buy', type: 'limit', price: 100, quantity: 6, client_id: 'b1' };
    const { trades, updatedOrders } = await engine.placeOrder(buyOrder);

    expect(trades).toHaveLength(1);
    expect(trades[0].quantity).toBe(6);

    expect(updatedOrders.find(o => o.order_id === buyOrder.order_id).status).toBe('filled');
    expect(updatedOrders.find(o => o.order_id === sellOrder.order_id).status).toBe('partially_filled');

    // Check book state
    const book = await engine.getOrderBook();
    expect(book.asks).toHaveLength(1);
    expect(book.asks[0].price).toBe(100);
    expect(book.asks[0].quantity).toBe(4); // 10 - 6
  });

  // Test 3: Price-time priority (with market order)
  test('should respect price-time priority', async () => {
    const sell1 = { order_id: uuidv4(), instrument: 'BTC-USD', side: 'sell', type: 'limit', price: 101, quantity: 5, client_id: 's1', timestamp: 1000 };
    const sell2 = { order_id: uuidv4(), instrument: 'BTC-USD', side: 'sell', type: 'limit', price: 100, quantity: 5, client_id: 's2', timestamp: 1001 }; // Best price
    const sell3 = { order_id: uuidv4(), instrument: 'BTC-USD', side: 'sell', type: 'limit', price: 100, quantity: 5, client_id: 's3', timestamp: 1002 }; // Same price, but later

    await engine.placeOrder(sell1);
    await engine.placeOrder(sell2);
    await engine.placeOrder(sell3);

    const book = await engine.getOrderBook();
    expect(book.asks.map(o => o.price)).toEqual([100, 101]);
    expect(book.asks[0].quantity).toBe(10); // 5 (from s2) + 5 (from s3)

    const buyOrder = { order_id: uuidv4(), instrument: 'BTC-USD', side: 'buy', type: 'market', quantity: 8, client_id: 'b1', timestamp: 1003 };
    const { trades } = await engine.placeOrder(buyOrder);

    expect(trades).toHaveLength(2);
    expect(trades[0].sell_order_id).toBe(sell2.order_id); // First trade matches s2
    expect(trades[0].quantity).toBe(5);
    expect(trades[1].sell_order_id).toBe(sell3.order_id); // Second trade matches s3
    expect(trades[1].quantity).toBe(3);

    // s3 should remain in the book
    const finalBook = await engine.getOrderBook();
    expect(finalBook.asks).toHaveLength(2); // s3 (partial) and s1
    expect(finalBook.asks[0].price).toBe(100);
    expect(finalBook.asks[0].quantity).toBe(2); // 5 - 3
  });

  // Test 4: Cancel order
  test('should cancel an open order', async () => {
    const orderIdToCancel = uuidv4();
    const buyOrder = { order_id: orderIdToCancel, instrument: 'BTC-USD', side: 'buy', type: 'limit', price: 100, quantity: 10, client_id: 'b1' };
    await engine.placeOrder(buyOrder);

    let book = await engine.getOrderBook();
    expect(book.bids).toHaveLength(1);

    const cancelledOrder = await engine.cancelOrder(orderIdToCancel);

    expect(cancelledOrder.status).toBe('cancelled');

    book = await engine.getOrderBook();
    expect(book.bids).toHaveLength(0);
  });
});