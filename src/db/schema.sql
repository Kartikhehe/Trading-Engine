-- Enum for order status
CREATE TYPE order_status AS ENUM (
  'open',
  'partially_filled',
  'filled',
  'cancelled',
  'rejected'
);

-- Enum for order side
CREATE TYPE order_side AS ENUM ('buy', 'sell');

-- Enum for order type
CREATE TYPE order_type AS ENUM ('limit', 'market');

-- Main orders table
CREATE TABLE orders (
  order_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id VARCHAR(255) NOT NULL,
  instrument VARCHAR(50) NOT NULL,
  side order_side NOT NULL,
  type order_type NOT NULL,
  price DECIMAL(18, 8), -- Nullable for market orders
  quantity DECIMAL(18, 8) NOT NULL,
  filled_quantity DECIMAL(18, 8) NOT NULL DEFAULT 0,
  status order_status NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trades table
CREATE TABLE trades (
  trade_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument VARCHAR(50) NOT NULL,
  buy_order_id UUID NOT NULL REFERENCES orders(order_id),
  sell_order_id UUID NOT NULL REFERENCES orders(order_id),
  price DECIMAL(18, 8) NOT NULL,
  quantity DECIMAL(18, 8) NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_instrument ON orders(instrument);
CREATE INDEX idx_trades_instrument_timestamp ON trades(instrument, timestamp DESC);