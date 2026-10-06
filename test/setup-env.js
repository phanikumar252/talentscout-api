// Imported first by every test file: env.js reads process.env once, at import time.
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = '';
process.env.MONGODB_DB_NAME = 'talentscout_test';
process.env.STREAM_DELAY_MS = '0';
process.env.EVALUATION_DELAY_MS = '0';
process.env.JWT_SECRET = 'test-secret-that-is-long-enough';
