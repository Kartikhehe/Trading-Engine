// load-test/script.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

export const options = {
  stages: [
    // 1. Ramp up to 100 virtual users (VUs) over 10s
    { duration: '10s', target: 100 }, 

    // 2. Stay at 100 VUs for 30s. This is our main load.
    // 100 VUs, each placing an order every ~50ms = 2000 orders/sec
    { duration: '30s', target: 100 },

    // 3. Ramp down
    { duration: '5s', target: 0 },
  ],
  thresholds: {
    // We want 95% of requests to be under 100ms
    'http_req_duration{group:::place_order}': ['p(95)<100'], 
    // We want 0 failures
    'http_req_failed{group:::place_order}': ['rate==0.0'],
  },
};

// Helper to get a random price around a midpoint
function getRandomPrice(midpoint) {
  return (Math.random() - 0.5) * 10 + midpoint;
}

export default function () {
  const url = 'http://localhost:3000/orders';
  const side = Math.random() > 0.5 ? 'buy' : 'sell';
  const price = side === 'buy' ? getRandomPrice(4990) : getRandomPrice(5010);

  const payload = JSON.stringify({
    idempotency_key: uuidv4(),
    client_id: `k6-vu-${__VU}`, // __VU is the virtual user ID
    instrument: 'BTC-USD',
    side: side,
    type: 'limit',
    price: price.toFixed(1), // 1 decimal precision
    quantity: (Math.random() * 0.1 + 0.01).toFixed(2), // Small quantity
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
    // Group requests for better metrics
    tags: { group: 'place_order' },
  };

  // Send the POST request
  const res = http.post(url, payload, params);

  // Check if the request was successful
  check(res, {
    'order placed status is 201 or 200 (idempotent)': (r) =>
      r.status === 201 || r.status === 200,
  });

  // A short sleep to simulate user think time.
  // 100 VUs * 1 sleep(0.05s) = 2000 req/s
  sleep(0.05); 
}