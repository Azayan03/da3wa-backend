```markdown
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

```

Generate a secure 32-character JWT secret and set it in `.env`:

```bash
openssl rand -hex 32

```

In `.env`, set:

```env
NODE_ENV=production
JWT_SECRET=<your-generated-hex-string>

```

**Step 2 — Launch the stack**

```bash
docker compose up -d --build

```

**What Docker Compose does automatically:**

1. Spins up `mongodb` (`mongo:7`) with persistent volume storage on an isolated network bridge (`app-net`).
2. Waits for MongoDB's healthcheck (`db.adminCommand('ping')`) to turn healthy.
3. Launches an ephemeral `migration` init container to backfill records and apply unique indexes (`username`, `email`, `googleId`).
4. Once migrations complete with exit code `0`, boots the `api` container as an unprivileged user (`node`) with `init: true` signal forwarding.

**Step 3 — Confirm service health**

```bash
curl http://localhost:3000/api/v1/health
# Expected: {"success":true,"data":{"status":"ok","database":"connected"}}

```

---

## 3. Local Installation (Bare Metal)

**Step 1 — Install dependencies**

Ensure you are running **npm 11** to prevent lockfile peer-dependency conflicts:

```bash
npm install -g npm@11
npm ci

```

**Step 2 — Start MongoDB**

```bash
# macOS
brew services start mongodb/brew/mongodb-community

# Linux (systemd)
sudo systemctl start mongod

```

**Step 3 — Run migrations & indexes**

Because `autoIndex` is disabled in production environments to eliminate cold-start lag, run index syncs before boot:

```bash
npm run db:migrate

```

---

## 4. Configuration

Every variable lives in `.env`. The server validates all variables at boot using Zod and **refuses to start** if any required key is missing or malformed.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `NODE_ENV` | no | `development` | `development`, `production`, or `test`. (Must be `production` inside containers) |
| `PORT` | no | `3000` | Port the API listens on |
| `API_PREFIX` | no | `/api/v1` | Prefix for every route. Must start with `/` |
| `MONGODB_URI` | **yes** | — | Connection string, or `memory` (local dev only) |
| `JWT_SECRET` | **yes** | — | Token signing key, minimum 32 characters |
| `JWT_EXPIRES_IN` | no | `1h` | Token lifetime: `<number><s|m|h|d>` |
| `COOKIE_SECURE` | no | `false` | Set `true` when serving over HTTPS |
| `COOKIE_SAME_SITE` | no | `lax` | Keep `lax`; `strict` breaks Google sign-in |
| `SWAGGER_ENABLED` | no | `true` | `false` returns 404 at `/docs` |
| `GOOGLE_CLIENT_ID` | **yes** | — | Google Cloud OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | **yes** | — | Google Cloud OAuth Client Secret |
| `GOOGLE_CALLBACK_URL` | **yes** | — | Must match Google Console verbatim |
| `FRONTEND_URL` | **yes** | — | Web client origin (CORS allow-list) |
| `FRONTEND_AUTH_CALLBACK_PATH` | no | `/auth/callback` | Path the Google callback redirects to |

---

## 5. Running the Server

### Local Development (Host)

```bash
npm run dev      # Restarts on file changes, uses pino-pretty
npm run build    # Compiles TypeScript to dist/
npm start        # Runs compiled code with standard JSON logging

```

### Docker Compose

```bash
docker compose up -d           # Run in background
docker compose logs -f api     # Tail API logs
docker compose ps -a           # Inspect container status and health
docker compose down            # Stop services
docker compose down -v         # Stop services and erase database volumes

```

---

## 6. Verify It Works

With the server running (locally or in Docker):

```bash
# 1. Liveness check (does not touch MongoDB)
curl http://localhost:3000/

# 2. Database readiness check
curl http://localhost:3000/api/v1/health
# {"success":true,"data":{"status":"ok","database":"connected"}}

# 3. Register a test account
curl -X POST http://localhost:3000/api/v1/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice_99","password":"password1"}'

# 4. Sign in and extract access token
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/signin \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice_99","password":"password1"}' | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)

# 5. Access protected route with Bearer token
curl http://localhost:3000/api/v1/auth/me -H "Authorization: Bearer $TOKEN"

```

Open [http://localhost:3000/docs](http://localhost:3000/docs) for the interactive Swagger UI.

---

## 7. Setting up Google Sign-in

1. **Google Cloud Console**: Go to [https://console.cloud.google.com/](https://console.cloud.google.com/).
2. **Consent Screen**:
* User Type: **External**
* Scopes: `openid`, `userinfo.email`, `userinfo.profile`
* While in **Testing**, add your Google email to **Test users**.


3. **Credentials**: *Create Credentials → OAuth client ID → Web application*
* **Authorized redirect URIs**: `http://localhost:3000/api/v1/auth/google/callback` (must match `GOOGLE_CALLBACK_URL` character-for-character).


4. **Initiate Sign-In**:
Open `http://localhost:3000/api/v1/auth/google` in a top-level browser window. The API will set a signed, temporary `oauth_state` cookie, authenticate with Google, and redirect to:
```
http://localhost:5173/auth/callback#access_token=eyJ...&token_type=Bearer&expires_in=3600

```



---

## 8. Frontend Integration

A reference client implementation is available in `examples/frontend-demo.html`:

```bash
node examples/serve.mjs      # Serves client at http://localhost:5173

```

Core integration patterns:

```javascript
const API = 'http://localhost:3000/api/v1';

// Sign in
const res = await fetch(`${API}/auth/signin`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'alice_99', password: 'password1' }),
});
const { data } = await res.json();
localStorage.setItem('accessToken', data.accessToken);

// Authenticated requests
await fetch(`${API}/auth/me`, {
  headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
});

// Google OAuth (Must be top-level navigation, never fetch)
window.location.href = `${API}/auth/google`;

// Read OAuth fragment on callback page
const params = new URLSearchParams(window.location.hash.slice(1));
const token = params.get('access_token');
if (token) {
  localStorage.setItem('accessToken', token);
  history.replaceState(null, '', window.location.pathname);
}

```

---

## 9. API Reference

Base path: `/api/v1`

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/` | — | Liveness ping (`{"message":"pong"}`). Does not touch database |
| `GET` | `/health` | — | Readiness check. Returns 200 or 503 depending on DB ping |
| `POST` | `/auth/signup` | — | Register username + password. Returns JWT |
| `POST` | `/auth/signin` | — | Sign in with username + password. Returns JWT |
| `GET` | `/auth/google` | — | Redirects to Google consent screen |
| `GET` | `/auth/google/callback` | — | Exchanges code and redirects to SPA fragment |
| `GET` | `/auth/me` | Bearer | Profile of current authenticated user |
| `POST` | `/auth/logout` | Bearer | Stateless confirmation; client discards token |

---

## 10. API Documentation (Swagger)

* **Interactive UI**: [http://localhost:3000/docs](http://localhost:3000/docs)
* **JSON Specification**: `http://localhost:3000/docs/json`
* **YAML Specification**: `http://localhost:3000/docs/yaml`

The OpenAPI 3.1 specification is derived at runtime from the Zod route schemas, guaranteeing that documentation and runtime validation never drift out of sync.

---

## 11. Testing

```bash
npm test

```

73 tests covering schemas, password hashing, Google token validation, and OpenAPI contract validation. Integration tests run against an isolated in-memory MongoDB instance (`mongodb-memory-server`) without requiring external infrastructure.

---

## 12. Docker & Container Architecture

The repository uses a multi-stage `Dockerfile` paired with an orchestrated `compose.yaml`.

```
                ┌───────────────────────────────────────┐
                │          Docker Virtual Bridge        │
                │                (app-net)              │
                │                                       │
┌──────────┐    │  ┌───────────┐      ┌──────────────┐  │
│  Client  │───:3000──>│    API    │─────>│   MongoDB    │  │
└──────────┘    │  │ (node:22) │      │   (mongo:7)  │  │
                │  └─────▲─────┘      └──────▲───────┘  │
                │        │ (starts after)    │          │
                │  ┌─────┴───────────────────┴───────┐  │
                │  │       Migration Container       │  │
                │  │ (sync-indexes & backfill-users) │  │
                │  └─────────────────────────────────┘  │
                └───────────────────────────────────────┘

```

### Highlights

* **Multi-Stage Build**: Compilation tools (`build-essential`, `python3`) and `devDependencies` are stripped out via `npm prune --omit=dev`. Final runtime image is lightweight Debian `node:22-slim`.
* **Non-Root User**: The runtime container executes as unprivileged user `node` (UID 1000).
* **Init Container Pattern**: In production, Mongoose sets `autoIndex: false` to prevent startup latency and race conditions. A standalone `migration` container synchronizes indexes and backfills user records before the API starts accepting traffic.
* **Signal Forwarding**: Container executes with `init: true` to enable proper zombie process reaping and graceful shutdown (`SIGTERM`/`SIGINT`).
* **Internal Network Isolation**: MongoDB does not expose port 27017 to the host machine, shielding the database from outside network scans.

---

## 13. Continuous Integration and Database Indexes

CI workflows run via [`.github/workflows/ci.yml`](https://www.google.com/search?q=.github/workflows/ci.yml):

1. **`test` Job**: Runs linting, typechecking (`tsc`), and Vitest against `mongodb-memory-server`. Requires zero secrets.
2. **`db-sync` Job ("Migrate Atlas")**: Runs `npm run db:migrate` against your cloud cluster on merge to `main`.

### Configuring CI for Your Own Repo

When cloning or forking this repository:

1. The `db-sync` job expects an environment named **`production`**.
2. Go to **GitHub Repo Settings → Environments → New environment → `production**`.
3. Add an Environment Secret named **`MONGODB_URI`** with your Atlas connection string:
```text
mongodb+srv://<user>:<password>@cluster.mongodb.net/invitations?retryWrites=true&w=majority

```


4. If you do not have an Atlas cluster, disable the `db-sync` step in `ci.yml` (`if: false`) to keep the pipeline green on tests alone.

---

## 14. Project Structure

```
├── compose.yaml                 # Multi-container orchestration (Mongo, Migration, API)
├── Dockerfile                   # Multi-stage production build (Node 22, npm 11)
├── src/
│   ├── app.ts                   # Fastify instance builder & plugin registrations
│   ├── server.ts                # Server boot and graceful shutdown handlers
│   ├── config/
│   │   ├── env.ts               # Runtime Zod validation for process.env
│   │   ├── database.ts          # Mongoose connection management
│   │   └── swagger.ts           # OpenAPI 3.1 & Swagger UI setup
│   ├── models/                  # Mongoose models & partial unique index definitions
│   ├── scripts/                 # Maintenance scripts (sync-indexes.ts, backfill-users.ts)
│   ├── modules/auth/            # Auth controllers, routes, Zod schemas, and services
│   ├── middleware/              # JWT bearer authenticate & global error handler
│   └── utils/                   # Argon2id hashing & AppError classes
├── examples/                    # Frontend demo client & static server
└── tests/                       # Unit & integration test suites

```

---

## 15. Security Notes

* **Argon2id**: Memory-hard password hashing; hashes are marked `{ select: false }` in Mongoose and never emitted in JSON responses.
* **Index Constraints**: Partial unique indexes (`{ $gt: "" }`) enforce uniqueness on non-empty values, preventing legacy `null` collisions.
* **CSRF Protection**: Google OAuth uses a signed, `httpOnly`, 10-minute state cookie.
* **Token Safety**: Google OAuth tokens return via URL fragment (`#access_token=...`), preventing credentials from leaking into server access logs or `Referer` headers.
* **Defense in Depth**: Fastify Helmet header protection, strict CORS origins, rate limiting (10 req/min on `/auth`), and non-root Docker user.

---

## 16. Troubleshooting

| Symptom | Cause | Solution |
| --- | --- | --- |
| `unable to determine transport target for "pino-pretty"` | Container has `NODE_ENV=development`, but `pino-pretty` was pruned | Set `NODE_ENV=production` in `.env` or Compose environment overrides |
| `npm ci` fails with `EUSAGE: Missing gcp-metadata...` | Image uses npm 10 instead of npm 11 | Upgrade Dockerfile to `node:22-slim` and run `npm install -g npm@11` |
| `ENOTFOUND host.docker.internal` (Linux) | Linux Docker doesn't resolve host loopback by default | Use Docker network service names (`mongodb:27017`) or add `extra_hosts: ["host.docker.internal:host-gateway"]` |
| `Bind for 0.0.0.0:27017 failed: port is already allocated` | Host process or another container already owns port 27017 | Remove the host port mapping under `mongodb` in `compose.yaml` (app communicates over bridge network) |
| Migration container exits with code `127` | Migration script invoked `tsx` which is pruned from runtime | Execute compiled JavaScript: `node dist/scripts/backfill-users.js && node dist/scripts/sync-indexes.js` |
| CI `db-sync` fails with `MONGODB_URI is not set` | Missing secret in GitHub repository/environment | Add `MONGODB_URI` under **Settings → Environments → production**, or disable the job |
| Google returns `redirect_uri_mismatch` | Callback URL does not match Google Console verbatim | Ensure `GOOGLE_CALLBACK_URL` matches Authorized Redirect URIs (`localhost`, not `127.0.0.1`) |
| `401 Invalid OAuth state` | Expired state or cookie blocked | Complete flow within 10 minutes; ensure `COOKIE_SAME_SITE=lax` |

---

## License

ISC

```

```