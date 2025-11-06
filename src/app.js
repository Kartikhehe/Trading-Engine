// src/app.js
const express = require('express');
const db = require('./db');
const orderRoutes = require('./api/orders');
const publicRoutes = require('./api/public');
const metrics = require('./core/MetricsService');

const app = express();

app.use(express.json()); // Middleware to parse JSON bodies

// --- Mount the routers ---
app.use('/orders', orderRoutes);
app.use('/public', publicRoutes);

// Health check endpoint
app.get('/healthz', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.status(200).json({ status: 'ok', db: 'connected' });
  } catch (e) {
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', metrics.register.contentType);
  res.end(await metrics.getMetrics());
});

// Export JUST the app
module.exports = app;