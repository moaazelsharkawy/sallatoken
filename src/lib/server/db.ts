// Import the built-in bun:sqlite module
import { Database as BunDatabase } from 'bun:sqlite';
import { Logger } from './utils/logger';
import { mkdir } from 'fs/promises'; // Import mkdir for directory creation
import { dirname } from 'path'; // Import dirname for path manipulation

const logger = new Logger('Database');

// Define the database file path
const DB_FILE = './data/withdrawals.sqlite';

// Define the SQL statement to create the withdrawals table
const CREATE_WITHDRAWALS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS withdrawals (
    request_id INTEGER PRIMARY KEY UNIQUE,
    user_id INTEGER NOT NULL,
    amount TEXT NOT NULL,
    recipient_address TEXT NOT NULL,
    token_address TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
    transaction_id TEXT UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    error_message TEXT -- To store error details if status is 'failed'
);
`;

// Use the BunDatabase type
let db: BunDatabase | null = null;

// Function to initialize the database
export async function initializeDatabase(): Promise<BunDatabase> {
    if (db) {
        logger.info('Database already initialized.');
        return db;
    }

    try {
        // Create the data directory if it doesn't exist
        await mkdir(dirname(DB_FILE), { recursive: true });
        logger.info(`Ensured data directory exists: ${dirname(DB_FILE)}`);

        logger.info(`Initializing database at ${DB_FILE}`);

        // Open the database connection using bun:sqlite
        // bun:sqlite's Database constructor is synchronous
        db = new BunDatabase(DB_FILE);
        logger.info('Database connection opened using bun:sqlite.');

        // Run the table creation SQL using bun:sqlite's run method
        // bun:sqlite's run method is synchronous
        db.run(CREATE_WITHDRAWALS_TABLE_SQL);
        logger.info('Withdrawals table checked/created using bun:sqlite.');

        logger.info('Database initialization complete.');
        return db;
    } catch (error: any) {
        logger.error('Failed to initialize database', error);
        throw new Error(`Database initialization failed: ${error.message}`);
    }
}

// Function to get the database instance
export function getDatabase(): BunDatabase {
    if (!db) {
        throw new Error('Database not initialized. Call initializeDatabase first.');
    }
    return db;
}

// Note: In a production app, you'd also want functions to close the database connection
// gracefully when the application shuts down.

