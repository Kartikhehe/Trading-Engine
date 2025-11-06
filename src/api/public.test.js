// src/api/public.test.js
jest.mock('../core/BroadcastService');
const request = require('supertest');
const app = require('../app');
const { engine } = require('../core/MatchingEngine');
const persistence = require('../core/PersistenceService');
const db = require('../db');
const client = require('../redisClient'); // <-- Import Redis client

// We will store the IDs of created orders to test against
let testOrderId;
let filledSellOrder;

describe('Public Read APIs', () => {
  // Before all tests, clear the DB and create some state
  beforeAll(async () => {
    // 1. Clear state
    await db.query('TRUNCATE orders, trades RESTART IDENTITY');
    await client.FLUSHDB(); // <-- FIX: Clear Redis
    
    // 2. Create a sell order that will be filled
    const sellOrder = {
      client_id: 'client-A',
      instrument: 'BTC-USD',
      side: 'sell',
      type: 'limit',
      price: 50000,
      quantity: 1,
    };
    // We must use the API to place orders now
    const resSell = await request(app).post('/orders').send(sellOrder);
    filledSellOrder = resSell.body.order;

    // 3. Create a buy order that will remain open
    const buyOrder = {
      client_id: 'client-B',
      instrument: 'BTC-USD',
      side: 'buy',
      type: 'limit',
      price: 49000, // Won't match
      quantity: 2,
    };
    const resBuy = await request(app).post('/orders').send(buyOrder);
    testOrderId = resBuy.body.order.order_id; // Save this ID
    
    // 4. Create a buy order that will cause a trade
    const matchingBuyOrder = {
      client_id: 'client-C',
      instrument: 'BTC-USD',
      side: 'buy',
      type: 'limit',
      price: 50000,
      quantity: 1,
    };
    await request(app).post('/orders').send(matchingBuyOrder);
    
    // 5. Wait for the persistence queue to finish
    await persistence.waitForIdle();
  });
  
  // After all tests, just wait for any lingering persistence
  afterAll(async () => {
    await persistence.waitForIdle();
  });

  test('GET /public/orderbook - should return the open order book', async () => {
    const res = await request(app).get('/public/orderbook?levels=1');
    
    expect(res.statusCode).toBe(200);
    
    // We expect the open buy order at 49000
    expect(res.body.bids).toHaveLength(1);
    expect(res.body.bids[0].price).toBe(49000);
    expect(res.body.bids[0].quantity).toBe(2);
    
    // The sell order at 50000 was filled, so asks should be empty
    expect(res.body.asks).toHaveLength(0);
  });

  test('GET /public/trades - should return the most recent trades', async () => {
    const res = await request(app).get('/public/trades?limit=1');
    
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].price).toBe('50000.00000000');
    expect(res.body[0].quantity).toBe('1.00000000');
    expect(res.body[0].sell_order_id).toBe(filledSellOrder.order_id);
  });
  
  test('GET /public/orders/:order_id - should return a single open order', async () => {
    const res = await request(app).get(`/public/orders/${testOrderId}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.order_id).toBe(testOrderId);
    expect(res.body.status).toBe('open');
    expect(res.body.price).toBe('49000.00000000');
  });

  test('GET /public/orders/:order_id - should return a single filled order', async () => {
    const res = await request(app).get(`/public/orders/${filledSellOrder.order_id}`);
    
    expect(res.statusCode).toBe(200);
    expect(res.body.order_id).toBe(filledSellOrder.order_id);
    expect(res.body.status).toBe('filled');
    expect(res.body.filled_quantity).toBe('1.00000000');
  });

  test('GET /public/orders/:order_id - should return 404 for missing order', async () => {
    const nonExistentId = '00000000-0000-0000-0000-000000000000';
    const res = await request(app).get(`/public/orders/${nonExistentId}`);
    
    expect(res.statusCode).toBe(404);
  });
});