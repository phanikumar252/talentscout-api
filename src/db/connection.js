import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import './models/index.js';

let memoryServer;

/**
 * Connects Mongoose. Without MONGODB_URI (dev/test only) it boots an in-memory
 * mongod so the project runs with zero setup.
 */
export async function connectDatabase() {
  let uri = env.MONGODB_URI;

  if (!uri) {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
    uri = memoryServer.getUri();
    if (!env.isTest) logger.warn('mongodb_in_memory', { note: 'MONGODB_URI not set; data resets on restart' });
  }

  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { dbName: env.MONGODB_DB_NAME, serverSelectionTimeoutMS: 5000 });

  // Build indexes up front: unique indexes back several business rules
  // (one charge per item, no duplicate shortlist entries), so they must exist before traffic.
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  if (!env.isTest) logger.info('mongodb_connected', { db: env.MONGODB_DB_NAME });
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
  await memoryServer?.stop();
  memoryServer = undefined;
}
