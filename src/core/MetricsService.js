// src/core/MetricsService.js
const client = require('prom-client');

// Enable default metrics (like CPU and memory usage)
const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics({ prefix: 'trading_engine_' });

// Create a Registry to register our custom metrics
const register = new client.Registry();
client.register.setDefaultLabels({
  app: 'trading-engine'
});

const MetricsService = {
  // --- Counters ---
  ordersReceived: new client.Counter({
    name: 'trading_engine_orders_received_total',
    help: 'Total number of orders received',
    labelNames: ['instrument', 'type', 'side'],
  }),
  ordersMatched: new client.Counter({
    name: 'trading_engine_orders_matched_total',
    help: 'Total number of orders that resulted in one or more trades',
    labelNames: ['instrument'],
  }),
  ordersRejected: new client.Counter({
    name: 'trading_engine_orders_rejected_total',
    help: 'Total number of orders rejected due to validation',
    labelNames: ['reason'],
  }),

  // --- Histogram ---
  orderLatency: new client.Histogram({
    name: 'trading_engine_order_latency_seconds',
    help: 'Latency for placing an order (from API receipt to engine response)',
    labelNames: ['operation'],
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5] // in seconds
  }),

  // --- Gauge ---
  orderBookDepth: new client.Gauge({
    name: 'trading_engine_orderbook_depth',
    help: 'Current number of price levels in the order book',
    labelNames: ['instrument', 'side'],
  }),

  // --- Register all metrics ---
  registerAll() {
    register.registerMetric(this.ordersReceived);
    register.registerMetric(this.ordersMatched);
    register.registerMetric(this.ordersRejected);
    register.registerMetric(this.orderLatency);
    register.registerMetric(this.orderBookDepth);
  },

  // --- Getter for the /metrics endpoint ---
  async getMetrics() {
    // Update the order book depth gauge right before scraping
    try {
      const [bids, asks] = await Promise.all([
        client.register.getSingleMetric('trading_engine_orderbook_depth').client.zCard('bids'),
        client.register.getSingleMetric('trading_engine_orderbook_depth').client.zCard('asks'),
      ]);
      this.orderBookDepth.set({ instrument: 'BTC-USD', side: 'buy' }, bids);
      this.orderBookDepth.set({ instrument: 'BTC-USD', side: 'sell' }, asks);
    } catch (e) {
      console.error("Could not update orderbook depth metric", e);
    }

    return register.metrics();
  }
};

// Register all metrics on init
MetricsService.registerAll();

module.exports = MetricsService;