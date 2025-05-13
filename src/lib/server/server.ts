import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config, validateConfig } from './config';
import { Logger } from './utils/logger';
import { apiKeyAuth } from './middleware/auth';
import { validateWithdrawalRequest, ensureIdempotency } from './middleware/validation';
import { processWithdrawal, getTransactionStatus } from './controllers/withdrawalController';
import { initializeDatabase } from './db';

const logger = new Logger('Server');

// Global error handlers
process.on('uncaughtException', (err) => {
  logger.error('FATAL: Unhandled Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('FATAL: Unhandled Rejection:', reason, promise);
});

const app = express();

// Validate configuration
const configValidation = validateConfig();
if (!configValidation.isValid) {
  logger.error('Invalid configuration', { errors: configValidation.errors });
  process.exit(1);
}

// تكوين trust proxy بشكل آمن
// استخدم 'loopback' للثقة فقط في البروكسيات المحلية
app.set('trust proxy', 'loopback');

// Middleware setup
app.use(helmet());
app.use(
  cors({
    methods: ['POST', 'GET'],
    allowedHeaders: ['Content-Type'],
  })
);
app.use(express.json());
app.use(
  rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    message: {
      status: 'failed',  message: 'Too many requests, please try again later',
      error_code: 'rate_limit_exceeded',
    },
  })
);

// Routes
app.post(
  '/api/process-solana-withdrawal',
  apiKeyAuth,
  validateWithdrawalRequest,
  ensureIdempotency,
  processWithdrawal
);

app.get('/api/transaction-status/:requestId', getTransactionStatus);

// Health check endpoint
app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

// Error handling middleware
app.use((err: any, req: any, res: any, next: any) => {
  logger.error('Unhandled error within request pipeline', err);
  res.status(500).json({
    status: 'failed',
    message: 'Internal server error',
    error_code: 'internal_error',
  });
});

// Exported startServer function
export const startServer = async (): Promise<void> => {
  const port = config.port;
  try {
    logger.info('Starting server initialization sequence...');

    // Initialize database
    await initializeDatabase();
    logger.info('Database initialized successfully.');

    logger.info(`Attempting to start HTTP server on port ${port}...`);

    // Start HTTP server
    const serverInstance = app.listen(port, '0.0.0.0', () => {
      logger.info(`Express server listening callback executed for port ${port}.`);
      logger.info(`Server started successfully on port ${port}`);
      logger.info(`Server accessible via network on http://<your_server_ip>:${port}`);
    });

    logger.info('app.listen call finished.');
    logger.info('app.listen function returned.');

    // Server error handler
    serverInstance.on('error', (err: any) => {
      logger.error('FATAL: Express server instance error:', err);
      process.exit(1);
    });
    logger.info('Server instance error handler attached.');

  } catch (error: any) {
    logger.error('FATAL: Failed during server startup', error);
    process.exit(1);
  }

  logger.info('startServer function execution completed.');
};

// Invoke startServer
startServer().catch((error) => {
  console.error('Unhandled error during async server startup:', error);
  process.exit(1);
});
