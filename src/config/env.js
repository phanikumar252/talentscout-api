import { z } from 'zod';

const DEV_SECRET = 'dev-only-secret-do-not-use-in-production';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    // Optional outside production: without it, an in-memory MongoDB is started.
    MONGODB_URI: z.string().url().optional().or(z.literal('').transform(() => undefined)),
    MONGODB_DB_NAME: z.string().min(1).default('talentscout'),
    JWT_SECRET: z.string().min(16).default(DEV_SECRET),
    JWT_EXPIRES_IN: z.string().default('8h'),
    CORS_ORIGIN: z.string().default('http://localhost:5173'),
    STREAM_DELAY_MS: z.coerce.number().int().min(0).default(30),
    EVALUATION_DELAY_MS: z.coerce.number().int().min(0).default(900),
  })
  .refine((env) => env.NODE_ENV !== 'production' || (env.JWT_SECRET !== DEV_SECRET && env.JWT_SECRET.length >= 32), {
    message: 'JWT_SECRET must be set to a 32+ character value in production',
    path: ['JWT_SECRET'],
  })
  .refine((env) => env.NODE_ENV !== 'production' || Boolean(env.MONGODB_URI), {
    message: 'MONGODB_URI is required in production',
    path: ['MONGODB_URI'],
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast on boot: a misconfigured server should never start serving traffic.
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = Object.freeze({
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGIN.split(',').map((origin) => origin.trim()),
  isTest: parsed.data.NODE_ENV === 'test',
});
