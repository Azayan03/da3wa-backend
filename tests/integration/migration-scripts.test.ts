import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';

const execAsync = promisify(exec);

describe('Compiled Migration Scripts (E2E Integration)', () => {
  let mongoServer: MongoMemoryServer;
  let uri: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    uri = mongoServer.getUri();

    // Ensure dist/ exists before running tests on compiled outputs
    const distPath = path.resolve(__dirname, '../../dist');
    if (!fs.existsSync(distPath)) {
      await execAsync('npm run build');
    }
  });

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    await mongoServer.stop();
  });

  it('runs backfill-users.js cleanly against an empty or legacy database', async () => {
    const scriptPath = path.resolve(__dirname, '../../dist/scripts/backfill-users.js');
    
    // Seed an un-backfilled legacy user directly via MongoDB driver
    await mongoose.connect(uri);
    const db = mongoose.connection.db;
    expect(db).toBeDefined();

    if (db) {
      await db.collection('users').insertOne({
        googleId: 'google-sub-12345',
        email: 'legacy@example.com',
        authProviders: ['google'],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    await mongoose.disconnect();

    // Run the compiled script as an external process
    const { stdout, stderr } = await execAsync(`node ${scriptPath}`, {
      env: {
        ...process.env,
        MONGODB_URI: uri,
      },
    });

    expect(stderr).toBe('');
    expect(stdout).toContain('Backfilling users on');

    // Verify user was given a valid username
    await mongoose.connect(uri);
    const updatedUser = await mongoose.connection.db?.collection('users').findOne({ googleId: 'google-sub-12345' });
    expect(updatedUser).toBeDefined();
    expect(updatedUser?.username).toMatch(/^username_\d+$/);
    await mongoose.disconnect();
  });

  it('runs sync-indexes.js and builds partial unique indexes correctly', async () => {
    const scriptPath = path.resolve(__dirname, '../../dist/scripts/sync-indexes.js');

    const { stdout, stderr } = await execAsync(`node ${scriptPath}`, {
      env: {
        ...process.env,
        MONGODB_URI: uri,
      },
    });

    expect(stderr).toBe('');
    expect(stdout).toContain('Syncing indexes on');
    expect(stdout).toContain('users: synced');

    // Verify indexes exist in MongoDB
    await mongoose.connect(uri);
    const indexes = await mongoose.connection.db?.collection('users').indexes();
    expect(indexes).toBeDefined();

    const indexNames = indexes?.map((idx) => Object.keys(idx.key)[0]);
    expect(indexNames).toContain('username');
    expect(indexNames).toContain('email');
    expect(indexNames).toContain('googleId');

    await mongoose.disconnect();
  });
});