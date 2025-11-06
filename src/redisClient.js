// src/redisClient.js
const { createClient } = require('redis');

// Create a singleton client
const client = createClient({
  // Your docker-compose exposes this on localhost
  url: 'redis://localhost:6379'
});

client.on('error', (err) => {
  console.error('Redis Client Error:', err);
});

// We must connect manually
client.connect();

module.exports = client;