# Portfolio

A Vite portfolio frontend with a Node.js backend for first-party analytics,
contact messages, and a protected admin dashboard.

## Features

- Vite frontend
- Local Docker production image
- First-party page-view and link-click tracking
- Contact form with locally stored messages
- Login-protected `/admin` dashboard
- Separate buttons to clear tracking events or contact messages
- Persistent runtime data under `backend/data`

## Project structure

```text
frontend/                 Vite source code
frontend/dist/            Generated production build (ignored by Git)
backend/server.js         API, admin login, dashboard, and static server
backend/public/admin.html Admin dashboard
backend/data/             Runtime data (ignored by Git)
backend/.env              Production secrets (ignored by Git)
Dockerfile                Multi-stage production image
docker-compose.yml        Production container configuration
update-production.sh      Git pull and local Docker update script
```

## Local development

Install frontend dependencies:

```powershell
cd frontend
npm install
```

Start the backend in another terminal:

```powershell
cd backend
node .\server.js
```

Start Vite:

```powershell
cd frontend
npm run dev
```

Open the development frontend at:

```text
http://localhost:30074
```

The Vite API proxy forwards requests to the backend on port `30073`.

## Production Docker deployment

The production image builds the frontend with Vite and then runs only the
Node.js backend. Vite is not run as a production service.

```text
frontend source -> Vite build -> frontend/dist -> Node backend
```

The production service uses port `30073`:

```text
http://localhost:30073/
http://localhost:30073/admin
```

## TrueNAS deployment

These steps use a local Docker Compose deployment. It does not require GHCR or
Docker Hub.

If the updater is missing after cloning, the version currently on GitHub does
not contain it yet. From Windows, commit and push the deployment files first:

```powershell
cd E:\portfolio_tom
git add .dockerignore .gitattributes Dockerfile docker-compose.yml `
  update-production.sh PRODUCTION.md README.md
git commit -m "Add TrueNAS production deployment"
git push origin main
```

### 1. Put the project on TrueNAS

Clone the GitHub repository into the dataset:

```sh
sudo git clone https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git \
  /mnt/main/websites/portfolio-tom
```

For a private repository, configure a non-interactive SSH deploy key first.

If you want to store the project in a different path, replace
`/mnt/main/websites/portfolio-tom` with your own project directory in all
commands below. You must update:

- The clone target path
- The `backend/.env` location path
- Every `cd /mnt/main/websites/portfolio-tom` command
- Every `/mnt/main/websites/portfolio-tom/update-production.sh` path
- The cron `Command` path

The Compose volume uses a relative path (`./backend/data`), so no
`docker-compose.yml` changes are needed as long as you run Compose from your
project directory.

The updater script also has a default path. If you use a different path,
either edit `PROJECT_DIR` in `update-production.sh` or run it with
`PROJECT_DIR=/your/path`.

### 2. Create the production environment file

Create:

```text
/mnt/main/websites/portfolio-tom/backend/.env
```

Use your own values:

```env
PORT=30073
ADMIN_USERNAME=your-admin-name
ADMIN_PASSWORD=use-a-long-random-password
SESSION_TTL_MS=86400000
NODE_ENV=production
REQUIRE_HTTPS=true
TRUST_PROXY=true
```

Never commit `backend/.env`.

`TRUST_PROXY=true` is only appropriate when an HTTPS reverse proxy overwrites
the `X-Forwarded-Proto` header. For direct local HTTP testing only, use:

```env
NODE_ENV=development
REQUIRE_HTTPS=false
TRUST_PROXY=false
```

### 3. Build and start the container

```sh
cd /mnt/main/websites/portfolio-tom
sudo docker compose down --remove-orphans
sudo docker compose build --no-cache
sudo docker compose up -d
```

Verify that the container is running before trying the website:

```sh
sudo docker compose ps -a
sudo docker compose logs --tail=100 portfolio
sudo docker inspect portfolio-tom --format '{{.State.Status}}'
```

If it is not running, rebuild and recreate it:

```sh
sudo docker compose down --remove-orphans
sudo docker compose build --no-cache --progress=plain
sudo docker compose up -d --force-recreate
```

For initial local testing without a reverse proxy, set these values in
`backend/.env`:

```env
NODE_ENV=development
REQUIRE_HTTPS=false
TRUST_PROXY=false
```

Then recreate the container. `REQUIRE_HTTPS=true` expects an HTTPS reverse
proxy; direct HTTP access can otherwise redirect away from the plain container.

Check the result:

```sh
sudo docker compose ps
sudo docker compose logs --tail=100 portfolio
```

The service should be available at:

```text
http://TRUENAS-IP:30073/
http://TRUENAS-IP:30073/admin
```

### 4. Preserve data

The Compose file mounts:

```text
/mnt/main/websites/portfolio-tom/backend/data
  -> /app/backend/data
```

Back up this directory. It contains:

```text
contacts.jsonl
events.jsonl
```

### 5. Use HTTPS publicly

Put an HTTPS reverse proxy in front of port `30073`, such as Nginx Proxy
Manager, Caddy, Traefik, or Cloudflare Tunnel. Do not expose the plain HTTP
container directly to the public internet.

The proxy should forward to:

```text
http://TRUENAS-IP:30073
```

## Automatic updates from GitHub

After pushing changes to GitHub:

```text
git push
  -> TrueNAS scheduled task runs update-production.sh
  -> git pull --ff-only
  -> local Docker image rebuilds
  -> container is recreated
```

Make the updater executable on TrueNAS:

```sh
ls -l /mnt/main/websites/portfolio-tom/update-production.sh
sudo chmod 750 /mnt/main/websites/portfolio-tom/update-production.sh
```

If `ls` reports that the file does not exist, sync the repository again:

```sh
cd /mnt/main/websites/portfolio-tom
sudo git pull --ff-only
ls -l update-production.sh
```

If the file is still missing, it was not pushed to GitHub. Push it from
Windows using the commands above, then run `git pull --ff-only` again.

If the file exists but cannot execute, normalize its line endings and set its
permission:

```sh
sed -i 's/\r$//' update-production.sh
sudo chmod 750 update-production.sh
sudo ./update-production.sh
```

Test it manually:

```sh
sudo /mnt/main/websites/portfolio-tom/update-production.sh
```

If your project is stored elsewhere, run:

```sh
sudo PROJECT_DIR=/your/path /your/path/update-production.sh
```

Then create a TrueNAS cron job under **System Settings > Advanced > Cron Jobs**:

```text
Command:  /mnt/main/websites/portfolio-tom/update-production.sh
Schedule: */15 * * * *
```

For a custom project path, use:

```text
Command:  PROJECT_DIR=/your/path /your/path/update-production.sh
```

This checks GitHub every 15 minutes. It rebuilds only when the Git commit has
changed. The updater uses `git pull --ff-only` and will not overwrite local
changes.

Git authentication must work without interactive prompts because cron cannot
enter a password. Test:

```sh
cd /mnt/main/websites/portfolio-tom
git pull --ff-only
```

## Troubleshooting

Check containers:

```sh
sudo docker compose ps -a
```

Check logs:

```sh
sudo docker compose logs --tail=100 portfolio
```

Rebuild after Dockerfile or dependency changes:

```sh
sudo docker compose build --no-cache
sudo docker compose up -d --force-recreate
```

If Docker reports `vite: Permission denied`, make sure `.dockerignore` is
present and rebuild with `--no-cache`. Windows `node_modules` must not be copied
into the Linux image.

## Security

- Use a new strong admin password.
- Keep `backend/.env` private.
- Keep `backend/data` private.
- Use HTTPS for public access.
- Do not expose the Docker socket or change its permissions to `666`.
- Back up the data directory before clearing logs or updating the container.
