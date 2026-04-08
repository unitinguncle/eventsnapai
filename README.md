# Orchestration API — Deployment Guide

## Prerequisites
- CompreFace stack already running in Portainer (network: compreface-net)
- RustFS running in Portainer
- Postgres accessible at compreface-postgres-db:5432

---

## Step 1 — Run the database migration

SSH into your server and run:

```bash
docker exec -i compreface-postgres-db psql -U postgres -d compreface < src/db/schema.sql
```

---

## Step 2 — Get your CompreFace API key

1. Open CompreFace at http://your-server:8000
2. Create an account or log in
3. Create a new Application (e.g. "EventPhotos")
4. Copy the API key from the application dashboard

---

## Step 3 — Deploy in Portainer

1. In Portainer, go to **Stacks → Add Stack**
2. Name it: `orchestration-api`
3. Set build method to **Repository** or paste the `docker-compose.yml` content
4. Add these environment variables in Portainer's env panel:

| Variable | Value |
|---|---|
| `ADMIN_API_KEY` | A long random string (your photographer upload key) |
| `JWT_SECRET` | Another long random string |
| `RUSTFS_ENDPOINT` | `http://rustfs:9000` (or your RustFS internal address) |
| `RUSTFS_ACCESS_KEY` | Your RustFS access key |
| `RUSTFS_SECRET_KEY` | Your RustFS secret key |
| `COMPREFACE_API_KEY` | Key from Step 2 |
| `ALLOWED_ORIGINS` | `https://yourdomain.com` |

5. Click **Deploy the stack**

---

## Step 4 — Verify the network

In Portainer, go to **Networks → compreface-net** and confirm
`orchestration-api` appears as a connected container.

---

## API Endpoints

### Admin (requires x-admin-key header)

```
POST /events                    Create a new event
GET  /events                    List all events
POST /upload/:eventId           Upload photos (multipart, field: files[])
```

### Visitor (requires Authorization: Bearer <token>)

```
GET  /events/:eventId/token     Get a visitor JWT (no auth needed — QR code target)
POST /search                    Submit selfie (multipart, field: selfie), get photo URLs
```

### Public

```
GET  /health                    Health check
```

---

## QR Code URL format

Generate a QR code pointing to:
```
https://yourdomain.com/events/{eventId}/token
```

The visitor scans it, gets a JWT, then the web app uses that JWT for `/search`.

---

## Generating a secure ADMIN_API_KEY and JWT_SECRET

Run this on any machine with Node.js:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Run it twice — once for each secret.
