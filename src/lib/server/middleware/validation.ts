
import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';

// Schema for withdrawal request validation
const withdrawalSchema = Joi.object({
  request_id: Joi.number().integer().required(),
  user_id: Joi.number().integer().required(),
  amount: Joi.string().pattern(/^\d*\.?\d*$/).required(), // Accepts "10.5", "10", etc.
  recipient_address: Joi.string().required(),
  token_address: Joi.string().required(),
  api_key: Joi.string().required()
});

/**
 * Middleware to validate withdrawal request payload
 */
export const validateWithdrawalRequest = (req: Request, res: Response, next: NextFunction) => {
  const { error } = withdrawalSchema.validate(req.body);
  
  if (error) {
    return res.status(400).json({
      status: 'failed',
      message: `Validation error: ${error.message}`,
      error_code: 'validation_error'
    });
  }
  
  next();
};

// Store processed request IDs to ensure idempotency
// In a production app, this should use Redis or a database
const processedRequestIds = new Set<number>();

/**
 * Middleware to ensure idempotency by checking if request_id has been processed
 */
export const ensureIdempotency = (req: Request, res: Response, next: NextFunction) => {
  const requestId = req.body.request_id;
  
  if (processedRequestIds.has(requestId)) {
    return res.status(409).json({
      status: 'failed',
      message: 'This withdrawal request has already been processed',
      error_code: 'duplicate_request'
    });
  }
  
  // Mark this request as being processed
  // Note: In production, this should be done atomically with database transactions
  processedRequestIds.add(requestId);
  
  next();
};
