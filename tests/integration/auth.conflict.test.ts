import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app';
import { setupTestDatabase, teardownTestDatabase } from '../helpers/setup';

describe('Auth Conflict & Unique Constraint Handling', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await setupTestDatabase();
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await teardownTestDatabase();
  });

  it('returns HTTP 409 when registering an identical username', async () => {
    // 1. Initial successful registration
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: {
        username: 'conflict_user',
        password: 'Password123',
      },
    });
    expect(res1.statusCode).toBe(201);

    // 2. Duplicate registration attempt
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: {
        username: 'conflict_user',
        password: 'Password123',
      },
    });

    expect(res2.statusCode).toBe(409);
    const body = res2.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.message).toMatch(/username is already taken/i);
  });

  it('rejects duplicate username with case-insensitivity', async () => {
    // 1. Initial registration with lowercase
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: {
        username: 'cased_user',
        password: 'Password123',
      },
    });

    // 2. Duplicate attempt with mixed uppercase
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: {
        username: 'Cased_User',
        password: 'Password123',
      },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('CONFLICT');
  });
});