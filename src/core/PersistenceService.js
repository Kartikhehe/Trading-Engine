// src/core/PersistenceService.js
const async = require('async');
const db = require('../db');

class PersistenceService {
  constructor() {
    // Create a queue with a concurrency of 1 (just like our engine)
    // This ensures DB writes for trades/orders happen one at a time.
    this.queue = async.queue(this._worker.bind(this), 1);

    this.queue.error((err, task) => {
      console.error('Persistence task failed:', err, 'Task:', task);
      // Here you might add logic to retry the task
    });
  }

  /**
   * The public "save" method.
   * This just adds the job to the queue and returns immediately.
   */
  save({ trades, updatedOrders }) {
    this.queue.push({ trades, updatedOrders });
  }

  async waitForIdle() {
    // If the queue is already idle, resolve immediately
    if (this.queue.idle()) {
      return Promise.resolve();
    }
    
    // Otherwise, return a promise that resolves when 'drain' is called
    return new Promise((resolve) => {
      this.queue.drain(resolve);
    });
  }

  /**
   * The private worker function that does the actual DB work.
   */
  async _worker(task) {
    const { trades, updatedOrders } = task;

    // We MUST use a transaction to ensure all or nothing.
    const client = await db.pool.connect(); // Get a client from the pool
    try {
      await client.query('BEGIN');

      //
      // FIX: 1. Save all updated orders FIRST
      //
      for (const order of updatedOrders) {
        await client.query(
          `INSERT INTO orders (order_id, client_id, instrument, side, type, price, quantity, filled_quantity, status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, to_timestamp($10 / 1000.0))
           ON CONFLICT (order_id) DO UPDATE SET
             filled_quantity = $8,
             status = $9,
             updated_at = now()`,
          [
            order.order_id, order.client_id, order.instrument, order.side,
            order.type, order.price || null, order.quantity, order.filled_quantity,
            order.status, order.timestamp
          ]
        );
      }

      //
      // FIX: 2. Save all trades SECOND
      //
      for (const trade of trades) {
        await client.query(
          `INSERT INTO trades (trade_id, instrument, buy_order_id, sell_order_id, price, quantity)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [trade.trade_id, trade.instrument, trade.buy_order_id, trade.sell_order_id, trade.price, trade.quantity]
        );
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('Failed to persist to DB, rolling back:', e.message);
      throw e; // Throw error to trigger queue.error handler
    } finally {
      client.release(); // ALWAYS release the client
    }
  }

  kill() {
    this.queue.kill();
  }
}

module.exports = new PersistenceService(); // Export singleton