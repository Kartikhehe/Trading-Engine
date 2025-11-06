// src/core/MatchingEngine.js
const { v4: uuidv4 } = require('uuid');
const client = require('../redisClient');

class MatchingEngine {
  constructor() {
    console.log('MatchingEngine (Redis) initialized.');
  }

  // --- Public Methods ---

  async placeOrder(order) {
    // 1. Set initial order properties
    order.timestamp = order.timestamp || Date.now();
    order.filled_quantity = 0;
    order.status = 'open';

    // 2. Match the order
    const { trades, updatedTakerOrder } = await this._matchOrder(order);

    // 3. If order not fully filled, add it to the book
    if (updatedTakerOrder.quantity > updatedTakerOrder.filled_quantity && updatedTakerOrder.type === 'limit') {
      await this._addOrderToBook(updatedTakerOrder);
    } else if (updatedTakerOrder.quantity <= updatedTakerOrder.filled_quantity) {
      updatedTakerOrder.status = 'filled';
    }

    // 4. Store the final state of the taker order
    if (updatedTakerOrder.status !== 'filled' || updatedTakerOrder.type === 'limit') {
      await client.hSet(`order:${order.order_id}`, this._orderToObject(updatedTakerOrder));
    }

    // 5. Get all updated maker orders (from the trades)
    //
    // --- THIS IS THE FIX ---
    // It should be 'order.side', not 'takerOrder.side'
    //
    const makerOrderIds = trades.map(t => (order.side === 'buy' ? t.sell_order_id : t.buy_order_id));
    const updatedMakerOrders = await this._getOrders(makerOrderIds);

    return { trades, updatedOrders: [updatedTakerOrder, ...updatedMakerOrders] };
  }

  async cancelOrder(orderId) {
    const orderData = await client.hGetAll(`order:${orderId}`);
    if (!orderData || Object.keys(orderData).length === 0) {
      return null; // Order not found
    }
    
    const order = this._hashToOrder(orderData);

    if (order.status === 'filled' || order.status === 'cancelled') {
      return null; // Can't cancel
    }

    const bookKey = order.side === 'buy' ? 'bids' : 'asks';
    const priceString = order.price.toString();
    const remainingQty = order.quantity - order.filled_quantity;

    // 1. Remove from the LIFO/FIFO list
    const removedCount = await client.lRem(`orders:${bookKey}:${priceString}`, 1, order.order_id);
    
    if (removedCount === 0) {
      order.status = 'cancelled';
      await client.hSet(`order:${order.order_id}`, 'status', 'cancelled');
      return order;
    }

    // 2. Decrement the depth hash
    const newDepth = await client.hIncrByFloat(`depth:${bookKey}`, priceString, -remainingQty);

    // 3. If depth is zero, remove from sorted set (price level)
    if (newDepth <= 0) {
      await client.zRem(bookKey, priceString);
      await client.hDel(`depth:${bookKey}`, priceString);
      await client.del(`orders:${bookKey}:${priceString}`);
    }

    // 4. Update order status
    order.status = 'cancelled';
    await client.hSet(`order:${order.order_id}`, 'status', 'cancelled');
    
    return order;
  }

  // --- Private Helper Methods (The Core Logic) ---

  async _matchOrder(takerOrder) {
    const trades = [];
    const bookKey = takerOrder.side === 'buy' ? 'asks' : 'bids';
    let takerRemainingQty = takerOrder.quantity;

    while (takerRemainingQty > 0) {
      // 1. Find the best price level in the opposite book
      const bestPriceEntry = await (takerOrder.side === 'buy' 
        ? client.zRange('asks', 0, 0) // Lowest ask
        : client.zRange('bids', 0, 0, { REV: true }) // Highest bid
      );
      
      if (!bestPriceEntry || bestPriceEntry.length === 0) {
        break; // Book is empty
      }
      
      const bestPrice = parseFloat(bestPriceEntry[0]);
      const bestPriceString = bestPriceEntry[0];
      
      // 2. Check if a match is possible
      if (!this._canMatch(takerOrder, bestPrice)) {
        break;
      }

      // 3. Get the *first* order (time priority) at that price
      const makerOrderId = await client.lPop(`orders:${bookKey}:${bestPriceString}`);
      
      if (!makerOrderId) {
        console.error(`CRITICAL: No order ID found at price ${bestPriceString}, but price level exists.`);
        await client.zRem(bookKey, bestPriceString);
        await client.hDel(`depth:${bookKey}`, bestPriceString);
        continue; 
      }

      const makerOrder = this._hashToOrder(await client.hGetAll(`order:${makerOrderId}`));
      const makerRemainingQty = makerOrder.quantity - makerOrder.filled_quantity;

      // 4. Determine trade quantity
      const tradeQuantity = Math.min(takerRemainingQty, makerRemainingQty);

      // 5. Create the trade
      const trade = {
        trade_id: uuidv4(),
        instrument: takerOrder.instrument,
        buy_order_id: takerOrder.side === 'buy' ? takerOrder.order_id : makerOrder.order_id,
        sell_order_id: takerOrder.side === 'sell' ? takerOrder.order_id : makerOrder.order_id,
        price: makerOrder.price,
        quantity: tradeQuantity,
        timestamp: Date.now(),
      };
      trades.push(trade);

      // 6. Update quantities and status
      takerRemainingQty -= tradeQuantity;
      takerOrder.filled_quantity += tradeQuantity;
      makerOrder.filled_quantity += tradeQuantity;
      
      makerOrder.status = (makerOrder.filled_quantity === makerOrder.quantity) ? 'filled' : 'partially_filled';
      
      // 7. Update depth cache
      await client.hIncrByFloat(`depth:${bookKey}`, bestPriceString, -tradeQuantity);

      // 8. If maker order is NOT filled, put it back at the FRONT of the line
      if (makerOrder.status !== 'filled') {
        await client.lPush(`orders:${bookKey}:${bestPriceString}`, makerOrder.order_id);
      } else {
        // If it *is* filled, check if the price level is now empty
        const newDepth = await client.hGet(`depth:${bookKey}`, bestPriceString);
        if (!newDepth || parseFloat(newDepth) <= 0) {
          await client.zRem(bookKey, bestPriceString);
          await client.hDel(`depth:${bookKey}`, bestPriceString);
          await client.del(`orders:${bookKey}:${bestPriceString}`);
        }
      }
      
      // 9. Update the maker order's hash in Redis
      await client.hSet(`order:${makerOrder.order_id}`, this._orderToObject(makerOrder));
    }
    
    if (takerOrder.filled_quantity > 0 && takerOrder.filled_quantity < takerOrder.quantity) {
      takerOrder.status = 'partially_filled';
    }
    
    return { trades, updatedTakerOrder: takerOrder };
  }

  async _addOrderToBook(order) {
    const bookKey = order.side === 'buy' ? 'bids' : 'asks';
    const priceString = order.price.toString();
    const remainingQty = order.quantity - order.filled_quantity;
    
    // 1. Add price to sorted set (for price-priority)
    await client.zAdd(bookKey, { score: order.price, value: priceString });
    
    // 2. Add order to list (for time-priority)
    await client.rPush(`orders:${bookKey}:${priceString}`, order.order_id);
    
    // 3. Update depth hash (for aggregation)
    await client.hIncrByFloat(`depth:${bookKey}`, priceString, remainingQty);
    
    // 4. Save the order data
    await client.hSet(`order:${order.order_id}`, this._orderToObject(order));
  }

  _canMatch(takerOrder, bestOppositePrice) {
    if (takerOrder.type === 'market') {
      return true;
    }
    if (takerOrder.side === 'buy') {
      return takerOrder.price >= bestOppositePrice;
    } else {
      return takerOrder.price <= bestOppositePrice;
    }
  }

  // --- Data Formatting Helpers ---

  _orderToObject(order) {
    // Converts a JS object to a new object suitable for hSet
    const orderData = {};
    for (const [key, value] of Object.entries(order)) {
      orderData[key] = value === null ? '' : value.toString();
    }
    return orderData;
  }
  
  _hashToOrder(hashData) {
    // Converts the flat object from hGetAll back to a typed JS object
    return {
      ...hashData,
      price: hashData.price ? parseFloat(hashData.price) : null,
      quantity: parseFloat(hashData.quantity),
      filled_quantity: parseFloat(hashData.filled_quantity),
      timestamp: parseInt(hashData.timestamp, 10),
    };
  }

  async _getOrders(orderIds) {
    if (!orderIds || orderIds.length === 0) return [];
    
    const pipeline = client.multi(); // Use multi()
    for (const id of orderIds) {
      pipeline.hGetAll(`order:${id}`);
    }
    const results = await pipeline.exec();
    return results.map(r => this._hashToOrder(r));
  }
  
  // --- Public Read Method (for GET /orderbook) ---
  
  async getOrderBook(instrument = 'BTC-USD', levels = 20) {
    //
    // --- THIS IS THE FIX for 'client.pipeline is not a function' ---
    //
    const bidsPipeline = client.multi(); // Use multi()
    bidsPipeline.zRange('bids', 0, levels - 1, { REV: true });
    bidsPipeline.hGetAll('depth:bids');
    
    const asksPipeline = client.multi(); // Use multi()
    asksPipeline.zRange('asks', 0, levels - 1);
    asksPipeline.hGetAll('depth:asks');

    const [bidResults, askResults] = await Promise.all([
      bidsPipeline.exec(),
      asksPipeline.exec()
    ]);
    
    const [bidPrices, bidDepths] = bidResults;
    const [askPrices, askDepths] = askResults;
    
    const format = (prices, depths) => {
      let cumulative = 0;
      if (!prices || !depths) return [];
      return prices.map(price => {
        const quantity = parseFloat(depths[price]);
        if (isNaN(quantity)) return null; // Safeguard for empty/corrupt depths
        cumulative += quantity;
        return { price: parseFloat(price), quantity, cumulative };
      }).filter(Boolean); // Filter out any nulls
    };
    
    return {
      bids: format(bidPrices, bidDepths),
      asks: format(askPrices, askDepths),
    };
  }
}

module.exports = {
  MatchingEngine,
  engine: new MatchingEngine(),
};