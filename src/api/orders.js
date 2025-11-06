// src/api/orders.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { engine } = require('../core/MatchingEngine');
const { validateOrder } = require('./middleware');
const persistence = require('../core/PersistenceService');
const broadcaster = require('../core/BroadcastService'); // <-- IMPORT
const metrics = require('../core/MetricsService');
const client = require('../redisClient'); // <-- Import redis client

const router = express.Router();

router.post('/', validateOrder, async (req, res) => {
  const endTimer = metrics.orderLatency.startTimer({ operation: 'place' });

  const idempotencyKey = req.body.idempotency_key;
  let cachedResult;

  if (idempotencyKey) {
    const key = `idempotency:${idempotencyKey}`;
    try {
      cachedResult = await client.get(key);
      if (cachedResult) {
        console.log(`Returning cached response for key: ${idempotencyKey}`);
        endTimer();
        return res.status(200).json(JSON.parse(cachedResult)); // Return the saved result
      }
    } catch (e) {
      console.error("Idempotency GET error:", e);
    }
  }

  try {
    const order = req.body;
    if (!order.order_id) order.order_id = uuidv4();

    metrics.ordersReceived.inc({
      instrument: order.instrument,
      type: order.type,
      side: order.side,
    });

    // 1. Call engine (fast)
    const { trades, updatedOrders } = await engine.placeOrder(order);

    const responsePayload = { // <-- Create the response object
      message: 'Order placed',
      order: updatedOrders[0],
      trades: trades,
    };

    // If we had a key, cache the successful result
    if (idempotencyKey) {
      try {
        await client.set(`idempotency:${idempotencyKey}`, JSON.stringify(responsePayload), {
          EX: 3600 // Cache for 1 hour
        });
      } catch (e) {
        console.error("Idempotency SET error:", e);
      }
    }

    // 2. Respond to user (fast)
    res.status(201).json(responsePayload); // <-- Send the object

    // 3. Fire-and-forget (background tasks)
    persistence.save({ trades, updatedOrders });

    // --- ADD THESE LINES ---
    broadcaster.broadcastTrades(trades);
    broadcaster.broadcastOrderUpdates(updatedOrders);
    broadcaster.broadcastOrderBook(order.instrument);
    // -----------------------

  } catch (error) {
    console.error('Error placing order:', error);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    endTimer();
  }
});

router.post('/:order_id/cancel', async (req, res) => {
  const endTimer = metrics.orderLatency.startTimer({ operation: 'cancel' }); // <-- START TIMER
  try {
    const { order_id } = req.params;

    // 1. Call engine (fast)
    const cancelledOrder = await engine.cancelOrder(order_id);

    if (!cancelledOrder) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // 2. Respond to user (fast)
    res.status(200).json({
      message: 'Order cancelled',
      order: cancelledOrder,
    });

    // 3. Fire-and-forget (background tasks)
    persistence.save({ trades: [], updatedOrders: [cancelledOrder] });

    // --- ADD THESE LINES ---
    broadcaster.broadcastOrderUpdates([cancelledOrder]);
    broadcaster.broadcastOrderBook(cancelledOrder.instrument);
    // -----------------------

  } catch (error) {
    console.error('Error cancelling order:', error);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    endTimer(); // <-- STOP TIMER
  }
});

module.exports = router;
