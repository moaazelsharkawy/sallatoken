
import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

/**
 * Middleware to validate API key in requests
 */
export const apiKeyAuth = (req: Request, res: Response, next: NextFunction) => {
  const apiKey = req.body.api_key;
  
  // No API key provided
  if (!apiKey) {
    return res.status(401).json({
      status: 'failed',
      message: 'API key is missing',
      error_code: 'missing_api_key'
    });
  }
  
  // Validate API key
  // Note: Using constant-time comparison is important for security to prevent timing attacks
  if (apiKey !== config.apiKey) {
    return res.status(401).json({
      status: 'failed',
      message: 'Invalid API key',
      error_code: 'invalid_api_key'
    });
  }
  
  // API key is valid, proceed to the next middleware
  next();
};
