
import winston from 'winston';

/**
 * Logger utility for consistent logging across the application
 */
export class Logger {
  private logger: winston.Logger;
  
  constructor(private context: string) {
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message, context, ...rest }) => {
          const contextStr = context ? `[${context}] ` : '';
          const restStr = Object.keys(rest).length ? JSON.stringify(rest) : '';
          return `${timestamp} ${level.toUpperCase()}: ${contextStr}${message} ${restStr}`;
        })
      ),
      defaultMeta: { context },
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'solana-withdrawal.log' })
      ]
    });
  }
  
  info(message: string, meta: object = {}) {
    this.logger.info(message, meta);
  }
  
  error(message: string, error: any = {}) {
    const errorData = error instanceof Error 
      ? { message: error.message, stack: error.stack }
      : error;
      
    this.logger.error(message, { error: errorData });
  }
  
  warn(message: string, meta: object = {}) {
    this.logger.warn(message, meta);
  }
  
  debug(message: string, meta: object = {}) {
    this.logger.debug(message, meta);
  }
}
