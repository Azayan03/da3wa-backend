import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { resetEnvCache } from '../../src/config/env';

// Cache downloaded mongod binaries across local and CI test runs
process.env.MONGOMS_DOWNLOAD_DIR = process.env.MONGOMS_DOWNLOAD_DIR || '/tmp/mongodb-binaries';

let mongoServer: MongoMemoryServer;

export const testEnv = {
  NODE_ENV: 'test',
  PORT: '3001',
  API_PREFIX: '/api/v1',
  JWT_SECRET: 'test-jwt-secret-minimum-32-characters-long',
  JWT_EXPIRES_IN: '1h',
  COOKIE_SECURE: 'false',
  COOKIE_SAME_SITE: 'lax',
  GOOGLE_CLIENT_ID: 'test-google-client-id',
  GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
  GOOGLE_CALLBACK_URL: 'http://localhost:3001/api/v1/auth/google/callback',
  FRONTEND_URL: 'http://localhost:5173',
  FRONTEND_AUTH_CALLBACK_PATH: '/auth/callback',
};

export function applyTestEnv(mongoUri: string): void {
  Object.assign(process.env, testEnv, {
    MONGODB_URI: mongoUri,
  });
  resetEnvCache();
}

export async function setupTestDatabase(): Promise<string> {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  applyTestEnv(uri);
  await mongoose.connect(uri);
  return uri;
}

export async function teardownTestDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    if (mongoose.connection.db) {
      await mongoose.connection.dropDatabase();
    }
    await mongoose.disconnect();
  }
  if (mongoServer) {
    await mongoServer.stop();
  }
  resetEnvCache();
}

export async function clearDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0 && mongoose.connection.db) {
    const collections = await mongoose.connection.db.collections();
    for (const collection of collections) {
      await collection.deleteMany({});
    }
  }
}

export function parseSetCookies(
  setCookieHeader: string | string[] | undefined,
): Record<string, string> {
  if (!setCookieHeader) {
    return {};
  }
  const headers = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  const cookies: Record<string, string> = {};
  for (const header of headers) {
    const [pair] = header.split(';');
    const eqIndex = pair.indexOf('=');
    if (eqIndex > 0) {
      const name = pair.slice(0, eqIndex).trim();
      const value = pair.slice(eqIndex + 1).trim();
      cookies[name] = value;
    }
  }
  return cookies;
}

export function bearer(accessToken: string): Record<string, string> {
  return { authorization: `Bearer ${accessToken}` };
}