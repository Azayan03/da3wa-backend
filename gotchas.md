# Gotchas

Real issues hit while modernizing the CI/CD pipeline, containerizing `da3wa-backend`, and configuring Nginx SSL termination, along with what actually fixed them. Kept here instead of in my head.

---

## `.env not found` in CI when running Docker Compose

Running `docker compose up -d --build` inside GitHub Actions crashed with:

```text
env file /home/runner/work/da3wa-backend/da3wa-backend/.env not found: stat ...: no such file or directory

```

* **The Misconception:** Thought `.dockerignore` was the culprit. `.dockerignore` only controls what gets sent to the Docker daemon during `docker build`.
* **The Cause:** Compose reads the host filesystem before building. Because `.env` was in `.gitignore`, `actions/checkout` never pulled it, causing `env_file: - .env` in `compose.yaml` to fail immediately on missing host path.
* **The Fix:** Changed Compose syntax to make `.env` explicitly optional:
```yaml
env_file:
  - path: .env
    required: false

```


* **The Architectural Takeaway:** Don't run `docker compose up` inside standard CI build jobs. Keep CI focused purely on **Build & Push** (Option 1: `docker/build-push-action`), keeping runners lean and eliminating secret requirements on the build VM.

---

## npm 10 vs npm 11 peer dependency resolution breakage

Node 22 ships with npm 10 by default. Running `npm ci` in GitHub Actions failed on lockfile mismatch (`package-lock.json` validation failure) due to unsatisfied optional peer dependencies (like `@google-cloud/functions-framework` / `gcp-metadata`).

* **Cause:** The project was built and lockfiled with npm 11. npm 10 calculates peer dependencies differently and treats npm 11's lockfile as dirty/out-of-sync.
* **Fix:** Pin npm 11 explicitly across all GitHub Actions jobs prior to running `npm ci`:
```yaml
- name: Pin npm 11
  run: npm install -g npm@11
- run: npm ci

```



---

## Bind-mounting `nginx.conf` created a directory instead of a file

Running `docker compose up` failed with:

```text
error mounting ".../nginx/nginx.conf" to rootfs at "/etc/nginx/conf.d/default.conf": mount src=... not a directory: Are you trying to mount a directory onto a file (or vice-versa)?

```

* **Cause:** The volume `./nginx/nginx.conf:/etc/nginx/conf.d/default.conf:ro` was declared before `nginx/nginx.conf` was created as an actual file on disk. Docker creates missing bind mount sources as **directories** by default.
* **Fix:**
1. Ran `docker compose down`.
2. Deleted the accidental directory: `rm -rf nginx/nginx.conf`.
3. Created `nginx.conf` as a standard text file (`nano nginx/nginx.conf`).
4. Verified with `ls -ld nginx/nginx.conf` (ensuring it starts with `-rw-`, not `drwx`).



---

## OpenSSL relative path nesting (`req: Can't open ... for writing`)

Attempted to generate certificates from inside `~/nginx/certs` using:

```bash
openssl req -keyout nginx/certs/nginx-privatekey.key -out nginx/certs/nginx-cert.crt ...

```

Failed with `Can't open "nginx/certs/nginx-privatekey.key" for writing, No such file or directory`.

* **Cause:** Running a command with `nginx/certs/` relative path while *already inside* `~/nginx/certs` causes OpenSSL to look for `~/nginx/certs/nginx/certs/...`, which doesn't exist.
* **Fix:** Target the local directory directly or navigate to the repository root before running path-relative commands.
* **Bonus Trap:** The command generated `nginx-privatekey.key` (missing hyphen), but `nginx.conf` expected `nginx-private.key`. Standardized naming to `nginx-private.key`.

---

## Self-signed certs rejected by modern browsers and curl (Missing SAN)

Generating an SSL certificate with only `-subj "/CN=localhost"` causes modern browsers (Chrome/Firefox) and modern TLS clients to reject the connection with `ERR_CERT_COMMON_NAME_INVALID`, ignoring the Common Name.

* **Fix:** Explicitly inject the `Subject Alternative Name` (SAN) extension for both localhost domain and loopback IP during generation:
```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout nginx/certs/nginx-private.key \
  -out nginx/certs/nginx-cert.crt \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

```



---

## Fastify `trustProxy` and global rate-limit lockout behind Nginx

When putting Fastify behind Nginx, Nginx sets `X-Forwarded-For` and `X-Forwarded-Proto`. By default, Fastify ignores proxy headers for security.

* **Symptom:** Fastify sees every single incoming request as originating from Nginx's internal Docker container IP (`172.20.0.X`).
* **Consequence:** Auth route rate limiters (e.g. 10 req/min) treat all external users as the exact same client IP. A single user hitting the rate limit blocks every user across the entire application with HTTP `429 Too Many Requests`.
* **Fix:** Fastify instance must be created with `trustProxy: true` in `src/app.ts`:
```typescript
const app = fastify({
  trustProxy: true,
});

```



---

## HTTP 301 redirection makes tests and scripts fail on port 3000

After removing the host port mapping (`3000:3000`) from the `api` container in `compose.yaml` to enforce reverse-proxy-only access:

* **Symptom:** `docker-smoke.sh` and local `curl http://localhost:3000/api/v1/health` failed with `Connection refused`.
* **Cause:** Fastify port 3000 now lives solely inside Docker's internal `app-net` bridge network. Port 80 and 443 on Nginx are the only open doors.
* **Fix:** Updated smoke tests and verification commands to use `curl -sk https://localhost/api/v1/health` and verify port 80 returns `301 Moved Permanently`.

---

## In-Memory MongoDB binary downloads throttling CI

Integration tests using `mongodb-memory-server` download a full ~100MB `mongod` binary on first execution.

* **Symptom:** The `test` stage in CI took minutes to run, repeatedly downloading the exact same binary on every push.
* **Fix:**
1. Configured `MONGOMS_DOWNLOAD_DIR = '/tmp/mongodb-binaries'` in `tests/helpers/setup.ts`.
2. Added GitHub Actions cache step in `.github/workflows/ci.yml`:
```yaml
- name: Cache MongoDB binaries
  uses: actions/cache@v4
  with:
    path: /tmp/mongodb-binaries
    key: mongodb-binaries-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
    restore-keys: mongodb-binaries-${{ runner.os }}-

```





---

## Trivy failing in CI due to tracked SSL keys

If `nginx/certs` or any `.key`/`.crt` files are accidentally tracked by Git, security scanners like Trivy (`aquasecurity/trivy-action`) with severity `CRITICAL,HIGH` fail the build during filesystem scans on secret/private key detection.

* **Fix:** Keep private keys out of the Git tree entirely. Added `nginx/certs/`, `*.key`, and `*.crt` to both `.gitignore` and `.dockerignore`.

---

## Production container missing `tsx` for migration commands

Running migrations in Docker via `tsx src/scripts/sync-indexes.ts` failed with `127: tsx not found`.

* **Cause:** Multi-stage production `Dockerfile` prunes `devDependencies` to keep images lightweight. `tsx` is a dev dependency and does not exist in the final runner stage.
* **Fix:** The container command must invoke compiled JavaScript from `dist/`:
```yaml
command: ["sh", "-c", "node dist/scripts/backfill-users.js && node dist/scripts/sync-indexes.js"]

```