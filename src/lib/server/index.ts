
import { startServer } from './server';
import { Logger } from './utils/logger';
import { config, buildSolanaRpcUrl } from './config';

const logger = new Logger('Main');

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled promise rejection', { reason, promise });
  process.exit(1);
});

// Log RPC connection information
const rpcInfo = {
  baseUrl: config.solanaRpcUrl,
  usingApiKey: !!config.solanaViewApiKey,
  finalUrl: buildSolanaRpcUrl().replace(config.solanaViewApiKey || '', '[REDACTED]')
};
logger.info('Solana RPC configuration', rpcInfo);

// Start the server
try {
  startServer();
  logger.info('Solana withdrawal processing service started successfully');
} catch (error) {
  logger.error('Failed to start the server', error);
  process.exit(1);
}
