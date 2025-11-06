// jest.teardown.js
const db = require('./src/db');
const persistence = require('./src/core/PersistenceService');
const client = require('./src/redisClient'); // <-- IMPORT

module.exports = async () => {
  persistence.kill();
  await db.pool.end();
  await client.quit(); // <-- ADD THIS
};