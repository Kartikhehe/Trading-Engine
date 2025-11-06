# Real-Time Trade Clearing & Analytics Engine

This is a high-performance, real-time backend service for a simplified financial exchange (BTC-USD). It is built to be scalable, resilient, and observable, handling high-throughput order ingestion and matching while persisting all trade activity and broadcasting events in real-time.

**Primary Skills Demonstrated:** System Design, API Design, Concurrency, Databases (Postgres & Redis), Streaming (WebSockets), Performance, Reliability, Security, and Testing.

---

## 🚀 Final Stack

* **Language:** Node.js
* **Framework:** Express.js
* **Database (Persistence):** PostgreSQL (for durable storage of orders & trades)
* **Database (Order Book):** Redis (for high-speed, atomic, in-memory matching)
* **Real-time:** `ws` (WebSocket) library
* **Testing:** Jest (Unit/Integration), k6 (Load Testing)
* **Observability:** `prom-client` (Prometheus metrics)
* **Containerization:** Docker

---

## 🛠️ How to Build and Run

### 1. Prerequisites

* Node.js (v18+)
* Docker & Docker Compose
* PostgreSQL Client (e.g., `psql`)
* `k6` (for load testing)

### 2. Run the Application

1.  **Clone the repository:**
    ```bash
    git clone [YOUR_REPO_URL]
    cd trading-engine
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Start external services (Postgres & Redis):**
    ```bash
    docker compose up -d
    ```
    This starts the required databases in detached mode.

4.  **Initialize the database schema:**
    This command connects to the Postgres container and executes the `schema.sql` file to create the `orders` and `trades` tables.
    ```bash
    docker compose exec -T postgres psql -U admin -d trading < src/db/schema.sql
    ```

5.  **Run the application:**
    ```bash
    npm run start:dev
    ```
    The server is now running on `http://localhost:3000`.

---

## 🧪 How to Run Tests

### 1. Unit & Integration Tests (Jest)

The test suite validates both the core matching logic against Redis and the full API request lifecycle.

* **Requirements:** Docker services (Postgres & Redis) must be running.
* **Command:**
    ```bash
    npm test
    ```

### 2. Load Tests (k6)

The load test script (`load-test/script.js`) simulates 100 concurrent users to verify the system meets the high-throughput performance targets.

* **Requirements:** The main application must be running in a separate terminal (`npm run start:dev`).
* **Command:**
    ```bash
    k6 run load-test/script.js
    ```

---

## 📖 API & WebSocket Examples

### 1. HTTP API (`curl`)

**Place a new Limit Order**
```bash
curl -X POST http://localhost:3000/orders \
     -H "Content-Type: application/json" \
     -d '{
            "idempotency_key": "a-unique-uuid-12345",
            "client_id": "client-A",
            "instrument": "BTC-USD",
            "side": "buy",
            "type": "limit",
            "price": 50000.0,
            "quantity": 0.5
        }'

