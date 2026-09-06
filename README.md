# da3wa-backend

Authentication REST API: username/password sign-up and sign-in, Google OAuth 2.0, and stateless
JWT bearer tokens, backed by MongoDB.

- **Sign up / sign in** with a username and password (Argon2id hashing)
- **Sign in with Google** using the OAuth 2.0 authorization-code flow
- **One credential**: a JWT returned in the response body. No cookies, no CSRF token
- **Interactive API docs** at `/docs`, generated from the same schemas that validate requests
- **Containerized & Orchestrated**: Multi-stage Dockerfile, non-root execution, and Docker Compose with init-container migrations
- **Typed and tested**: TypeScript, Zod, Vitest test suite

---

## Table of contents

1. [Requirements](#1-requirements)
2. [Quickstart with Docker Compose](#2-quickstart-with-docker-compose)
3. [Local Installation (Bare Metal)](#3-local-installation-bare-metal)
4. [Configuration](#4-configuration)
5. [Running the Server](#5-running-the-server)
6. [Verify It Works](#6-verify-it-works)
7. [Setting up Google Sign-in](#7-setting-up-google-sign-in)
8. [Frontend Integration](#8-frontend-integration)
9. [API Reference](#9-api-reference)
10. [API Documentation (Swagger)](#10-api-documentation-swagger)
11. [Testing](#11-testing)
12. [Docker & Container Architecture](#12-docker--container-architecture)
13. [Continuous Integration and Database Indexes](#13-continuous-integration-and-database-indexes)
14. [Project Structure](#14-project-structure)
15. [Security Notes](#15-security-notes)
16. [Troubleshooting](#16-troubleshooting)

---

## 1. Requirements

| Requirement | Version | Notes |
|---|---|---|
| **Node.js** | `>= 22.0.0` | Developed on 22/26. Base images use `node:22-slim` |
| **npm** | `>= 11.0.0` | Ships with Node 23+, or run `npm install -g npm@11` to match lockfile resolution |
| **Docker & Compose** | Compose v2+ | Recommended deployment method |
| **MongoDB** | `>= 6` | Local Community, Atlas, or Docker container (`mongo:7`) |
| **A C++ Toolchain** | — | Required for bare-metal only (`argon2` native compilation). Debian/Ubuntu: `build-essential python3`. macOS: Xcode CLT |
| **Google OAuth Credentials** | — | Required only for `/auth/google` routes; local auth works without them |

---

## 2. Quickstart with Docker Compose

The fastest way to launch the entire stack (Database, Schema Migrations, and API) is via Docker Compose.

**Step 1 — Clone and prepare environment**

```bash
git clone <your-repo-url> da3wa-backend
cd da3wa-backend
cp .env.example .env