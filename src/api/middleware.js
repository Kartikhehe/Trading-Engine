// src/api/middleware.js
const Joi = require('joi');

// Schema for a new order
const orderSchema = Joi.object({
  idempotency_key: Joi.string().uuid(), // Optional for now
  order_id: Joi.string().uuid(), // Optional, we can generate one
  client_id: Joi.string().required(),
  instrument: Joi.string().valid('BTC-USD').required(),
  side: Joi.string().valid('buy', 'sell').required(),
  type: Joi.string().valid('limit', 'market').required(),
  price: Joi.number().when('type', {
    is: 'limit',
    then: Joi.number().positive().required(),
    otherwise: Joi.forbidden(), // Market orders must NOT have a price
  }),
  quantity: Joi.number().positive().required(),
});

const validateOrder = (req, res, next) => {
  const { error } = orderSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      message: 'Validation failed',
      details: error.details.map((d) => d.message),
    });
  }
  next(); // Validation passed
};

module.exports = { validateOrder };