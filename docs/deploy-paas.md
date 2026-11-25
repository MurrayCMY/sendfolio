# Deploy on Railway, Render, Fly.io and other container platforms

SendFolio ships a `Dockerfile`, so any platform that runs a container and offers PostgreSQL and a persistent disk works.
**The maintainers have not tested these platforms yet**; the steps below are the standard recipe. If you hit a snag, please open an issue.

## What you need to set up

1. **A service from this repository**, built with the `Dockerfile`. It listens on port `8787` and has a health check at `/healthz`.
2. **A PostgreSQL database.** Use the platform's managed Postgres and set `DATABASE_URL` to its connection string.
3. **A persistent volume** mounted at `/app/data` (page images and signed PDFs are stored in `/app/data/files`).
   Without a volume, uploads disappear on every redeploy.
4. **Environment variables**: `SESSION_SECRET`, `ADMIN_EMAIL`, `SITE_URL`, `SMTP_*`, `MAIL_FROM`, plus `TRUST_PROXY=true` and `HSTS=true`
   (the platform terminates HTTPS in front of the app). See [configuration.md](configuration.md).
5. **A custom domain** if you want one; update `SITE_URL` to match.

## Platform notes

- **Railway**: New Project → Deploy from GitHub → add the PostgreSQL plugin → reference its URL as `DATABASE_URL` → add a Volume at `/app/data`.
- **Render**: New Web Service (Docker) → add a PostgreSQL instance → add a Disk at `/app/data` (a paid instance is required for disks).
- **Fly.io**: `fly launch` (it detects the Dockerfile), `fly postgres create` and attach it, `fly volumes create data` and mount it at `/app/data`,
  set secrets with `fly secrets set`.
- **Kubernetes / Nomad / Coolify / CapRover**: use the image, one replica, the same variables, and a `PersistentVolumeClaim` for `/app/data`.

Run exactly **one replica**: file storage is on a local volume, and the background job runs inside the app process.
(If you need several replicas, point storage at shared storage first; an S3 storage driver is on the wishlist.)

## Check

```bash
curl -fsS https://your-service.example.com/healthz
```
then open `/admin`.
