// src/api/orders.test.js
jest.mock('../core/BroadcastService');
const request = require('supertest');
const app = require('../app');
const { engine } = require('../core/MatchingEngine');
const { v4: uuidv4 } = require('uuid');
const persistence = require('../core/PersistenceService');
const client = require('../redisClient'); // <-- Import Redis client

// This hook will run after all tests in this file are done
afterAll(async () => {
  await persistence.waitForIdle();
});

// Reset the engine before each test
beforeEach(async () => {
  await client.FLUSHDB(); // <-- FIX: Clear Redis, not in-memory objects
});

describe('POST /orders', () => {
  test('should place a limit buy order successfully', async () => {
    const order = {
      client_id: 'client-1',
      instrument: 'BTC-USD',
      side: 'buy',
      type: 'limit',
      price: 50000,
      quantity: 1.5,
    };

    const res = await request(app).post('/orders').send(order);

    expect(res.statusCode).toBe(201);
    expect(res.body.message).toBe('Order placed');
    expect(res.body.order.status).toBe('open');
    expect(res.body.order.order_id).toBeDefined();
    expect(res.body.trades).toHaveLength(0);

    // Check if it's in the book
    const book = await engine.getOrderBook();
    expect(book.bids).toHaveLength(1);
    expect(book.bids[0].price).toBe(50000);
  });

  test('should return 400 for invalid order (e.g., limit without price)', async () => {
    const order = {
      client_id: 'client-1',
      instrument: 'BTC-USD',
      side: 'buy',
      type: 'limit', // Limit, but no price
      quantity: 1.5,
    };

    const res = await request(app).post('/orders').send(order);
    expect(res.statusCode).toBe(400);
    // ... (rest of test is fine)
  });

  test('should execute a trade immediately if match found', async () => {
    // 1. Pre-load the book with a sell order
    const sellOrder = {
      order_id: uuidv4(),
      client_id: 'client-A',
      instrument: 'BTC-USD',
      side: 'sell',
      type: 'limit',
      price: 50000,
      quantity: 1,
    };
    await engine.placeOrder(sellOrder); // Use engine directly to set up

    // 2. Send a matching buy order via API
    const buyOrder = {
      client_id: 'client-B',
      instrument: 'BTC-USD',
      side: 'buy',
      type: 'limit',
      price: 50000,
      quantity: 1,
    };

    const res = await request(app).post('/orders').send(buyOrder);

    expect(res.statusCode).toBe(201);
    expect(res.body.order.status).toBe('filled');
    expect(res.body.trades).toHaveLength(1);
    
    // Book should be empty
    const book = await engine.getOrderBook();
    expect(book.bids).toHaveLength(0);
    expect(book.asks).toHaveLength(0);
  });
});

describe('POST /orders/:order_id/cancel', () => {
  test('should cancel an open order', async () => {
    const orderIdToCancel = uuidv4(); 

    // 1. Place an order
    const order = {
      order_id: orderIdToCancel, 
      client_id: 'client-1',
      instrument: 'BTC-USD',
      side: 'buy',
      type: 'limit',
      price: 49000,
      quantity: 1,
    };
    await engine.placeOrder(order);

    // Ensure it's in the book
    let book = await engine.getOrderBook();
    expect(book.bids).toHaveLength(1);

    // 2. Send cancel request
    const res = await request(app)
      .post(`/orders/${orderIdToCancel}/cancel`)
      .send();

    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe('Order cancelled');
    expect(res.body.order.status).toBe('cancelled');

    // Book should now be empty
    book = await engine.getOrderBook();
    expect(book.bids).toHaveLength(0);
  });
});