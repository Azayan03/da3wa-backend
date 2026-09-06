# da3wa-backend

Authentication REST API: username/password sign-up and sign-in, Google OAuth 2.0, and stateless
JWT bearer tokens, backed by MongoDB.

* **Sign up / sign in** with a username and password (Argon2id hashing)
* **Sign in with Google** using the OAuth 2.0 authorization-code flow
* **One credential**: a JWT returned in the response body. No cookies, no CSRF token
* **Interactive API docs** at `/docs`, generated from the same schemas that validate requests
* **Containerized & Orchestrated**: Multi-stage Dockerfile, non-root execution, init-container migrations, and Nginx reverse proxy with SSL termination
* **CI/CD Hardened**: 4-stage GitHub Actions workflow (Lint $\to$ Test $\to$ Scan $\to$ Build) with Trivy and Docker Hub delivery
* **Typed and tested**: TypeScript, Zod, Vitest test suite with cached in-memory MongoDB

---

## Table of contents

1. [Requirements](https://www.google.com/search?q=%231-requirements)
2. [Quickstart with Docker Compose](https://www.google.com/search?q=%232-quickstart-with-docker-compose)
3. [Local Installation (Bare Metal)](https://www.google.com/search?q=%233-local-installation-bare-metal)
4. [Configuration](https://www.google.com/search?q=%234-configuration)
5. [Running the Server](https://www.google.com/search?q=%235-running-the-server)
6. [Verify It Works](https://www.google.com/search?q=%236-verify-it-works)
7. [Setting up Google Sign-in](https://www.google.com/search?q=%237-setting-up-google-sign-in)
8. [Frontend Integration](https://www.google.com/search?q=%238-frontend-integration)
9. [API Reference](https://www.google.com/search?q=%239-api-reference)
10. [API Documentation (Swagger)](https://www.google.com/search?q=%2310-api-documentation-swagger)
11. [Testing](https://www.google.com/search?q=%2311-testing)
12. [Docker & Reverse Proxy Architecture](https://www.google.com/search?q=%2312-docker--reverse-proxy-architecture)
13. [Continuous Integration & Delivery (CI/CD)](https://www.google.com/search?q=%2313-continuous-integration--delivery-cicd)
14. [Project Structure](https://www.google.com/search?q=%2314-project-structure)
15. [Security Notes](https://www.google.com/search?q=%2315-security-notes)
16. [Troubleshooting](https://www.google.com/search?q=%2316-troubleshooting)

---

## 1. Requirements

| Requirement | Version | Notes |
| --- | --- | --- |
| **Node.js** | `>= 22.0.0` | Developed on 22/26. Base images use `node:22-slim` |
| **npm** | `>= 11.0.0` | Ships with Node 23+, or run `npm install -g npm@11` to match lockfile resolution |
| **Docker & Compose** | Compose v2+ | Recommended deployment method |
| **OpenSSL** | Latest | Required to generate self-signed TLS certificates for local Nginx |
| **MongoDB** | `>= 6` | Local Community, Atlas, or Docker container (`mongo:7`) |
| **A C++ Toolchain** | — | Required for bare-metal only (`argon2` native compilation). Debian/Ubuntu: `build-essential python3`. macOS: Xcode CLT |
| **Google OAuth Credentials** | — | Required only for `/auth/google` routes; local auth works without them |

---

## 2. Quickstart with Docker Compose

The fastest way to launch the complete production stack (MongoDB, Init Migrations, Fastify API, and Nginx Reverse Proxy).

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
COOKIE_SECURE=true

```

**Step 2 — Generate SSL certificates for Nginx**

Create the local certificates directory and generate a SAN-compliant self-signed certificate:

```bash
mkdir -p nginx/certs

openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout nginx/certs/nginx-private.key \
  -out nginx/certs/nginx-cert.crt \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

chmod 600 nginx/certs/nginx-private.key
chmod 644 nginx/certs/nginx-cert.crt

```

**Step 3 — Launch the stack**

```bash
docker compose up -d --build

```

**What Docker Compose does automatically:**

1. Boots `mongodb` (`mongo:7`) with volume persistence on the internal `app-net` bridge network.
2. Waits for MongoDB's healthcheck (`db.adminCommand('ping')`) to turn healthy.
3. Launches the ephemeral `migration` init container to backfill records and reconcile partial unique indexes.
4. Boots the `api` container as an unprivileged user (`node`) with internal port 3000 exposed only within `app-net`.
5. Starts `nginx` listening on ports 80 and 443, issuing HTTP $\to$ HTTPS 301 redirects and reverse-proxying HTTPS traffic with HTTP/1.1 keep-alive connections to `api`.

**Step 4 — Confirm service health**

```bash
# Verify HTTP to HTTPS 301 redirection
curl -I http://localhost/api/v1/health

# Verify HTTPS readiness (-k bypasses self-signed certificate warning)
curl -sk https://localhost/api/v1/health
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

Because `autoIndex` is disabled in production to eliminate cold-start latency, run index syncs before boot:

```bash
npm run db:migrate

```

---

## 4. Configuration

Every variable lives in `.env`. The server validates all variables at boot using Zod and **refuses to start** if any required key is missing or malformed.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `NODE_ENV` | no | `development` | `development`, `production`, or `test` |
| `PORT` | no | `3000` | Port the API listens on internally |
| `API_PREFIX` | no | `/api/v1` | Prefix for every route. Must start with `/` |
| `MONGODB_URI` | **yes** | — | Connection string, or `memory` (local dev only) |
| `JWT_SECRET` | **yes** | — | Token signing key, minimum 32 characters |
| `JWT_EXPIRES_IN` | no | `1h` | Token lifetime: `<number><s|m|h|d>` |
| `COOKIE_SECURE` | no | `false` | Set `true` when serving over HTTPS / behind Nginx |
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
docker compose up -d           # Run stack in background
docker compose logs -f nginx   # Tail Nginx reverse proxy logs
docker compose logs -f api     # Tail Fastify API logs
docker compose ps              # Inspect container status and healthchecks
docker compose down            # Stop services
docker compose down -v         # Stop services and erase database volumes

```

---

## 6. Verify It Works

With the stack running:

```bash
# 1. Liveness ping (bypasses MongoDB)
curl -sk https://localhost/

# 2. Database readiness check
curl -sk https://localhost/api/v1/health
# {"success":true,"data":{"status":"ok","database":"connected"}}

# 3. Register a test account
curl -sk -X POST https://localhost/api/v1/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice_99","password":"password1"}'

# 4. Sign in and extract access token
TOKEN=$(curl -sk -X POST https://localhost/api/v1/auth/signin \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice_99","password":"password1"}' | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)

# 5. Access protected route with Bearer token
curl -sk https://localhost/api/v1/auth/me -H "Authorization: Bearer $TOKEN"

```

Open [https://localhost/docs](https://localhost/docs) for interactive Swagger documentation.

---

## 7. Setting up Google Sign-in

1. **Google Cloud Console**: Go to [https://console.cloud.google.com/](https://console.cloud.google.com/).
2. **Consent Screen**:
* User Type: **External**
* Scopes: `openid`, `userinfo.email`, `userinfo.profile`
* While in **Testing**, add your Google email to **Test users**.


3. **Credentials**: *Create Credentials → OAuth client ID → Web application*
* **Authorized redirect URIs**: `https://localhost/api/v1/auth/google/callback` (must match `GOOGLE_CALLBACK_URL` character-for-character).


4. **Initiate Sign-In**:
Open `https://localhost/api/v1/auth/google` in a top-level browser window. The API sets a signed, temporary `oauth_state` cookie, authenticates with Google, and redirects to:
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
const API = 'https://localhost/api/v1';

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

* **Interactive UI**: [https://localhost/docs](https://localhost/docs)
* **JSON Specification**: `https://localhost/docs/json`
* **YAML Specification**: `https://localhost/docs/yaml`

The OpenAPI 3.1 specification is derived at runtime from Zod schemas, guaranteeing that documentation and runtime validation stay perfectly in sync.

---

## 11. Testing

### Unit and Integration Tests (Vitest)

```bash
npm test

```

73+ tests covering schemas, password hashing, Google token validation, and OpenAPI contracts. Integration tests run against an isolated in-memory MongoDB instance (`mongodb-memory-server`) with cached binaries in `/tmp/mongodb-binaries` to eliminate repeat downloads.

### Container & Proxy Smoke Tests

```bash
chmod +x tests/e2e/docker-smoke.sh
./tests/e2e/docker-smoke.sh

```

Builds the compose stack, validates that the migration init container exits with code 0, verifies API container health, tests the HTTP 301 redirect on port 80, tests registration over HTTPS on port 443, and cleans up volumes.

---

## 12. Docker & Reverse Proxy Architecture

The production environment isolates application services behind an Nginx edge proxy inside an internal Docker network (`app-net`).

```
                 Host Network
                      │
        ┌─────────────┴─────────────┐
        │  :80 (HTTP)  :443 (HTTPS) │
        └─────────────┬─────────────┘
                      ▼
         ┌─────────────────────────┐
         │          Nginx          │ (SSL Termination, HTTP 301 Redirect)
         └────────────┬────────────┘
                      │  app-net (Internal Docker Bridge)
         ┌────────────┴────────────┐
         │                         │
         ▼                         ▼
   ┌───────────┐             ┌───────────┐
   │    API    │             │  MongoDB  │
   │ (Port 3000│             │ (Port     │
   │ internal) │             │  27017)   │
   └─────▲─────┘             └─────▲─────┘
         │ (starts after)          │
   ┌─────┴─────────────────────────┴─────┐
   │         Migration Container         │
   │  (backfill-users & sync-indexes)    │
   └─────────────────────────────────────┘

```

### Key Architectural Standards

* **Edge SSL Termination**: Nginx terminates TLS (TLSv1.2/1.3) and passes traffic to Fastify via HTTP/1.1 keep-alive connections.
* **Port Shielding**: Neither `api` (3000) nor `mongodb` (27017) expose ports on the host machine; all inbound traffic is forced through Nginx on ports 80/443.
* **Fastify `trustProxy**`: Fastify honors `X-Forwarded-For` and `X-Forwarded-Proto` set by Nginx, ensuring IP rate-limiting applies to client IPs rather than Nginx's internal container IP.
* **Init Container Pattern**: In production, `autoIndex: false` prevents serverless cold starts. The `migration` service reconciles indexes and user documents before the API starts accepting traffic.
* **Least Privilege**: The Node runtime executes as the unprivileged `node` user (UID 1000) with `no-new-privileges:true` and `init: true` signal forwarding.

---

## 13. Continuous Integration & Delivery (CI/CD)

The GitHub Actions workflow ([`.github/workflows/ci.yml`](https://www.google.com/search?q=.github/workflows/ci.yml)) implements a strict 4-stage delivery pipeline:

```
[ Lint ] ──> [ Test ] ──> [ Scan ] ──> [ Build & Push ]

```

1. **Lint**: Typechecks TypeScript with `tsc --noEmit` on Node 22 and npm 11.
2. **Test**: Runs the Vitest test suite against `mongodb-memory-server` using GitHub Actions layer-cached binaries (`/tmp/mongodb-binaries`).
3. **Scan**: Dual-layer security audit:
* `npm audit --omit=dev --audit-level=high` (SCA for runtime dependencies).
* Trivy filesystem scan (`aquasecurity/trivy-action`) targeting `CRITICAL,HIGH` vulnerabilities.


4. **Build**: Compiles the multi-stage Docker image using BuildKit (`type=gha` layer caching), authenticates with Docker Hub, and pushes `<username>/da3wa-backend:latest` on merges to `main`.

---

## 14. Project Structure

```
├── compose.yaml                 # Multi-container orchestration (Mongo, Migration, API, Nginx)
├── Dockerfile                   # Multi-stage production build (Node 22, npm 11)
├── nginx/
│   ├── nginx.conf               # SSL reverse proxy & HTTP-to-HTTPS redirect configuration
│   └── certs/                   # TLS certificate & private key (git-ignored)
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
└── tests/                       # Unit, integration, and E2E container smoke tests

```

---

## 15. Security Notes

* **Argon2id**: Memory-hard password hashing; hashes are marked `{ select: false }` in Mongoose and never emitted in JSON responses.
* **Index Constraints**: Partial unique indexes (`{ $gt: "" }`) enforce uniqueness on non-empty values, preventing legacy `null` collisions.
* **CSRF Protection**: Google OAuth uses a signed, `httpOnly`, 10-minute state cookie.
* **Token Safety**: Google OAuth tokens return via URL fragment (`#access_token=...`), preventing credentials from leaking into server access logs or `Referer` headers.
* **Reverse Proxy Hardening**: Nginx handles SSL termination with TLSv1.2/1.3 only, enforcing HTTPS via 301 redirects.
* **Secret Isolation**: SSL private keys and `.env` files are strictly excluded via `.gitignore` and `.dockerignore`.

---

## 16. Troubleshooting

| Symptom | Cause | Solution |
| --- | --- | --- |
| `mount ... not a directory` on Nginx startup | `nginx/nginx.conf` did not exist on host or was created as a directory | Delete the erroneous folder (`rm -rf nginx/nginx.conf`) and create it as a standard text file |
| `curl: (60) SSL certificate problem: self-signed` | Self-signed certificate used locally | Use `curl -k` or `--insecure` for local testing, or add the cert to your OS trust store |
| `429 Too Many Requests` on all requests behind Nginx | Fastify seeing Nginx's bridge IP instead of client IP | Ensure `trustProxy: true` is configured in Fastify's `buildApp()` options |
| `querySrv ENOTFOUND` in migrations | Atlas connection URI contains invalid placeholder hostname | Update `MONGODB_URI` with your actual cluster address from cloud.mongodb.com |
| Migration container exits with code `127` | Migration script invoked `tsx` which was pruned from production image | Execute compiled JavaScript: `node dist/scripts/backfill-users.js && node dist/scripts/sync-indexes.js` |
| `npm ci` fails with lockfile error in CI | Runner using npm 10 instead of npm 11 | Add `npm install -g npm@11` step before running `npm ci` |
| Google returns `redirect_uri_mismatch` | Callback URL does not match Google Console verbatim | Ensure `GOOGLE_CALLBACK_URL` matches Authorized Redirect URIs (`localhost`, not `127.0.0.1`) |

---

## License

ISC