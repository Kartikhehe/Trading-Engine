// src/api/public.js
const express = require('express');
const { engine } = require('../core/MatchingEngine');
const db = require('../db');

const router = express.Router();

/**
 * GET /public/orderbook?instrument=BTC-USD&levels=20
 * Returns the aggregated order book (hot data from memory)
 */
router.get('/orderbook', async (req, res) => { // <-- ADD ASYNC
  const instrument = req.query.instrument || 'BTC-USD';
  const levels = parseInt(req.query.levels || 20, 10);
  
  try {
    const orderBook = await engine.getOrderBook(instrument, levels); // <-- ADD AWAIT
    res.status(200).json(orderBook);
  } catch (e) {
    console.error('Error fetching orderbook:', e);
    res.status(500).json({ message: 'Internal server error' });
  }
});

/**
 * GET /public/trades?instrument=BTC-USD&limit=50
 * Returns the most recent trades (warm data from database)
 */
router.get('/trades', async (req, res) => {
  const instrument = req.query.instrument || 'BTC-USD';
  const limit = parseInt(req.query.limit || 50, 10);

  try {
    const { rows } = await db.query(
      `SELECT * FROM trades
       WHERE instrument = $1
       ORDER BY timestamp DESC
       LIMIT $2`,
      [instrument, Math.min(limit, 100)] // Cap limit at 100
    );
    res.status(200).json(rows);
  } catch (e) {
    console.error('Error fetching trades:', e);
    res.status(500).json({ message: 'Internal server error' });
  }
});

/**
 * GET /public/orders/:order_id
 * Returns the state of a single order (warm data from database)
 */
router.get('/orders/:order_id', async (req, res) => {
  const { order_id } = req.params;

  try {
    const { rows } = await db.query(
      'SELECT * FROM orders WHERE order_id = $1',
      [order_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    res.status(200).json(rows[0]);
  } catch (e) {
    console.error('Error fetching order:', e);
    // Handle invalid UUID format
    if (e.code === '22P02') {
      return res.status(400).json({ message: 'Invalid order_id format' });
    }
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;