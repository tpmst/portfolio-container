# Production deployment

This project runs as one production container:

```text
Vite source -> production image build -> frontend/dist -> Node backend
```

Vite is not run in production. The runtime container serves the built frontend,
API, contact form, and `/admin` dashboard on port `30073`.

## TrueNAS

From the project directory on TrueNAS:

```sh
cd /mnt/main/websites/portfolio-tom
sudo docker compose down
sudo docker compose build --no-cache
sudo docker compose up -d
sudo docker compose logs -f portfolio
```

The site is then available at:

```text
http://TRUENAS-IP:30073/
http://TRUENAS-IP:30073/admin
```

## Environment

Create `backend/.env` on TrueNAS and use a new strong password:

```env
PORT=30073
ADMIN_USERNAME=tom
ADMIN_PASSWORD=replace-with-a-long-random-password
SESSION_TTL_MS=86400000
NODE_ENV=production
REQUIRE_HTTPS=true
TRUST_PROXY=true
```

`TRUST_PROXY=true` is appropriate only when an HTTPS reverse proxy is in front
of the container and overwrites `X-Forwarded-Proto`. The proxy should forward
to:

```text
http://TRUENAS-IP:30073
```

Do not expose the container directly to the public internet without HTTPS.
When testing directly over local HTTP, temporarily use
`REQUIRE_HTTPS=false` and restore it before public deployment.

The persistent data directory is:

```text
./backend/data
```

It contains contact messages and tracking events and should be included in
TrueNAS snapshots/backups.

## Automatic updates without GHCR

The project can update its local image directly from a Git checkout. It does
not require Docker Hub or GitHub Container Registry.

1. Put the project in a Git checkout on TrueNAS.
2. Set the Git remote and authenticate it using an SSH deploy key or another
   TrueNAS-supported credential method.
3. Make the updater executable:

   ```sh
   chmod 750 /mnt/main/websites/portfolio-tom/update-production.sh
   ```

4. Test it manually:

   ```sh
   /mnt/main/websites/portfolio-tom/update-production.sh
   ```

The script uses `git pull --ff-only`, so it will not overwrite local changes.
It rebuilds and recreates the container only when the Git commit changes. The
`backend/.env` and `backend/data` files are excluded from the Docker build and
remain on the TrueNAS dataset.

### Schedule it in TrueNAS

Create a **System Settings > Advanced > Cron Jobs** task:

- Command:
  `/mnt/main/websites/portfolio-tom/update-production.sh`
- User:
  a user with permission to read the project and run Docker Compose
- Schedule:
  every 15 minutes, hourly, or daily
- Hide standard output:
  disabled while testing; enable after confirming it works

TrueNAS will run the script on that schedule. The lock directory prevents two
updates from running at the same time. Review the cron task output and
`sudo docker compose logs --tail=100 portfolio` if an update fails.

This keeps the service as a local Docker Compose deployment. It will not appear
as a catalog-managed application in the TrueNAS Apps list; the TrueNAS Cron
task manages updates instead.
