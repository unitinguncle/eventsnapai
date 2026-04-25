# EventSnapAI v2 — Implementation Plan
**Version:** 2.0.0  
**Status:** Pre-build (Unraid containers partially deployed)  
**Last updated:** 2026-04-24

---

## Table of Contents

1. [Infrastructure Topology](#1-infrastructure-topology)
2. [Network Architecture](#2-network-architecture)
3. [Container Registry](#3-container-registry)
4. [Unraid Deployments](#4-unraid-deployments)
5. [Ubuntu VM Deployments](#5-ubuntu-vm-deployments)
6. [Environment Variables Master List](#6-environment-variables-master-list)
7. [Pipeline 1 — Ingestion](#7-pipeline-1--ingestion)
8. [Pipeline 2 — Compression](#8-pipeline-2--compression)
9. [Pipeline 3 — Face Indexing](#9-pipeline-3--face-indexing)
10. [Pipeline 4 — Delivery](#10-pipeline-4--delivery)
11. [Authentication and Session Strategy](#11-authentication-and-session-strategy)
12. [Database Schema Changes](#12-database-schema-changes)
13. [Observability Stack](#13-observability-stack)
14. [What Changes vs Current Codebase](#14-what-changes-vs-current-codebase)
15. [Migration and Upgrade Paths](#15-migration-and-upgrade-paths)

---

## 1. Infrastructure Topology

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  CLOUDFLARE  [pre-configured, activate on domain publish]                       │
│  SSL termination · DDoS · edge caching for thumbnail/static assets             │
└──────────────────────────────────┬──────────────────────────────────────────────┘
                                   │ HTTPS :443
┌──────────────────────────────────▼──────────────────────────────────────────────┐
│  UNRAID BARE METAL  (Ryzen 5 5600G · 64 GB RAM)                                │
│                                                                                 │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │  NGINX  :80/:443                                                         │  │
│  │  least_conn · health checks · rate limits · WebSocket upgrade            │  │
│  │  proxy_request_buffering off  (upload streams pass-through)              │  │
│  └───────────────┬───────────────────────────────┬──────────────────────────┘  │
│                  │                               │                             │
│  ┌───────────────▼──────────┐   ┌───────────────▼──────────┐                 │
│  │  REDIS  :6379            │   │  SEAWEEDFS               │                 │
│  │  db:0  compression queue │   │  master    :9333         │                 │
│  │  db:1  indexing queue    │   │  volume    :8080         │                 │
│  │  db:2  dedup cache       │   │  filer     :8888         │                 │
│  │  db:3  socket.io pub/sub │   │  S3 API    :8333         │                 │
│  │  db:4  replica lag cache │   │  filer.toml → VM-1 PG   │                 │
│  │  AOF: appendfsync=everysec│  │  cold tier after 15 days │                 │
│  └──────────────────────────┘   └──────────────────────────┘                 │
│                                                                                 │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │  MONITORING                                                              │  │
│  │  Prometheus :9090 · Grafana :3000 · node_exporter :9100                │  │
│  │  redis_exporter :9121 · nginx_exporter :9113 · cAdvisor :8080          │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
└────────┬───────────────────────────────────────────────────────────────────────┘
         │  LAN (same Unraid host, bridge network 172.20.0.0/16)
┌────────▼──────────────────────────┐    ┌──────────────────────────────────────┐
│  UBUNTU VM-1  (Unraid-hosted)     │    │  UBUNTU VM-2  (Unraid-hosted now,    │
│  PRIMARY NODE                     │    │  migrate to Proxmox later)           │
│                                   │    │                                      │
│  eventsnapai-app      :3001       │    │  eventsnapai-app      :3001          │
│  eventsnapai-worker   :9092/:9093 │    │  eventsnapai-worker   :9092/:9093    │
│  insightface-sidecar  :8001       │    │  insightface-sidecar  :8001          │
│  postgres PRIMARY     :5432       │◄──►│  postgres STANDBY     :5432          │
│  pgbouncer (RW)       :5433       │WAL │  pgbouncer (RO)       :5433          │
│  node_exporter        :9100       │    │  node_exporter        :9100          │
│  cadvisor             :8080       │    │  cadvisor             :8080          │
│  postgres_exporter    :9187       │    │  postgres_exporter    :9187          │
└───────────────────────────────────┘    └──────────────────────────────────────┘
```

---

## 2. Network Architecture

### Unraid Docker Networks (already created)

```
eventsnapai-backend    172.20.0.0/16   bridge
  All Unraid app containers communicate here.
  Ubuntu VMs reach Unraid containers via VM LAN IP → Unraid LAN IP.
  Containers: nginx, redis, seaweedfs-master, seaweedfs-volume,
              seaweedfs-filer, redis_exporter, nginx_exporter

eventsnapai-monitoring  172.21.0.0/16   bridge
  Isolated metrics plane.
  Prometheus scrapes targets on both networks.
  Containers: prometheus, grafana, node_exporter, cadvisor
  Cross-network: prometheus also attached to eventsnapai-backend
                 so it can scrape redis, nginx, seaweedfs directly.
```

### Static IP Assignments (Unraid containers)

```
172.20.0.10   redis
172.20.0.20   seaweedfs-master
172.20.0.21   seaweedfs-volume
172.20.0.22   seaweedfs-filer
172.20.0.30   nginx
172.21.0.10   prometheus
172.21.0.20   grafana
```

### Ubuntu VM Network

```
VM-1 and VM-2 are on the Unraid bridge network.
Assign each VM a static LAN IP (set in Unraid VM network settings).
Example:
  VM-1 LAN IP:  192.168.1.101   (replace with your actual subnet)
  VM-2 LAN IP:  192.168.1.102

All containers inside each Ubuntu VM run on an internal Docker bridge:
  Network name: eventsnapai-vm
  Subnet:       10.10.1.0/24    (VM-1)
                10.10.2.0/24    (VM-2)

Containers expose ports to the VM's LAN IP where needed.
The VM's LAN IP is what Nginx, Prometheus, and Redis reference.
```

### Communication Map

```
WHO                  TALKS TO              VIA                      PORT
────────────────────────────────────────────────────────────────────────────
nginx (Unraid)    →  VM-1 Node app         VM-1 LAN IP              3001
nginx (Unraid)    →  VM-2 Node app         VM-2 LAN IP              3001
Node app (VM-1)   →  Redis                 172.20.0.10              6379
Node app (VM-2)   →  Redis                 172.20.0.10              6379
Worker (VM-1)     →  Redis                 172.20.0.10              6379
Worker (VM-2)     →  Redis                 172.20.0.10              6379
Node app (VM-1)   →  SeaweedFS S3 API      172.20.0.22              8333
Node app (VM-2)   →  SeaweedFS S3 API      172.20.0.22              8333
Worker (VM-1)     →  SeaweedFS S3 API      172.20.0.22              8333
Worker (VM-2)     →  SeaweedFS S3 API      172.20.0.22              8333
Node app (VM-1)   →  InsightFace sidecar   localhost (same VM)      8001
Node app (VM-2)   →  InsightFace sidecar   localhost (same VM)      8001
Worker (VM-1)     →  InsightFace sidecar   localhost (same VM)      8001
Worker (VM-2)     →  InsightFace sidecar   localhost (same VM)      8001
Node app (VM-1)   →  Postgres primary      localhost PgBouncer      5433
Node app (VM-2)   →  Postgres primary      VM-1 LAN IP PgBouncer   5433 (writes)
Node app (VM-2)   →  Postgres standby      localhost PgBouncer      5433 (reads)
Node app (VM-1)   →  Postgres standby      VM-2 LAN IP PgBouncer   5433 (reads, fallback)
SeaweedFS filer   →  Postgres primary      VM-1 LAN IP              5432 (filer metadata)
Prometheus        →  All exporters         respective IPs            various
Socket.io (VM-1)  →  Redis pub/sub         172.20.0.10 db:3         6379
Socket.io (VM-2)  →  Redis pub/sub         172.20.0.10 db:3         6379
```

---

## 3. Container Registry

### Already pulled on Unraid ✓

```
redis:7.2-alpine                          ✓ done
chrislusf/seaweedfs:latest                ✓ done
nginx:1.25-alpine                         ✓ done
prom/node-exporter:v1.8.0                 ✓ done
oliver006/redis_exporter:v1.62.0          ✓ done
nginx/nginx-prometheus-exporter:1.1.0     ✓ done
gcr.io/cadvisor/cadvisor:v0.49.1          ✓ done
```

### Still needed on Unraid

```
prom/prometheus:v2.51.0
  Note: You have Prometheus for Immich. Options:
  A) Add EventSnapAI scrape jobs to existing Prometheus config.
     Edit existing prometheus.yml, add scrape_configs entries.
  B) Run a second Prometheus instance on a different port (:9091).
  Recommendation: Option A — one Prometheus, multiple job configs.

grafana/grafana:10.4.0
  Note: Same as Prometheus. You have Grafana for Immich.
  Recommendation: Add EventSnapAI as a new datasource and dashboard
  folder in existing Grafana. No new container needed.
```

### Pull on Ubuntu VM-1 and VM-2

```
ankane/pgvector:v0.7.0
  Replaces postgres:16-alpine. Has pgvector pre-installed.
  docker pull ankane/pgvector:v0.7.0

edoburu/pgbouncer:latest
  docker pull edoburu/pgbouncer:latest

prom/node-exporter:v1.8.0
  docker pull prom/node-exporter:v1.8.0

gcr.io/cadvisor/cadvisor:v0.49.1
  docker pull gcr.io/cadvisor/cadvisor:v0.49.1

quay.io/prometheuscommunity/postgres-exporter:v0.15.0
  docker pull quay.io/prometheuscommunity/postgres-exporter:v0.15.0
  Note: wrouesnel/postgres_exporter is deprecated. Use prometheuscommunity image.
```

### Custom images (built from repo, not pulled)

```
eventsnapai-app       Built from: Dockerfile.app
                      node:20-alpine base
                      Contains: src/ public/ package.json
                      CMD: node src/server.js
                      Ports: 3001 (HTTP+WS), 9091 (metrics)

eventsnapai-worker    Built from: Dockerfile.worker
                      node:20-alpine base
                      Contains: src/ package.json
                      CMD: node src/workers/main.js
                      Role controlled by: WORKER_TYPE=compression|indexing
                      Ports: 9092 (compression metrics), 9093 (indexing metrics)

eventsnapai-insightface  Built from: face-sidecar/Dockerfile
                         python:3.11-slim base
                         Models pre-downloaded at build time into image layer
                         Volume mount overlays /models (cached across rebuilds)
                         Ports: 8001 (HTTP + /metrics)
```

---

## 4. Unraid Deployments

Deploy in this exact order. Each step depends on the previous.

---

### 4.1 Redis

```
Container name:    redis
Image:             redis:7.2-alpine
Network:           eventsnapai-backend
Static IP:         172.20.0.10
Port:              6379 (internal network only — do NOT expose to host)
Restart:           always

Bind mounts:
  /mnt/user/appdata/eventsnapai/redis/data  →  /data

Command override:
  redis-server
    --appendonly yes
    --appendfsync everysec
    --save 900 1
    --save 300 10
    --maxmemory 4gb
    --maxmemory-policy allkeys-lru
    --databases 5

No env vars needed for sandbox (no password).
Production: add --requirepass <strong_password>
            and update REDIS_PASSWORD in all .env files.

Verify after deploy:
  docker exec -it redis redis-cli ping
  → PONG

  docker exec -it redis redis-cli config get appendonly
  → appendonly / yes
```

**What to update after Redis is running:**
- `REDIS_HOST` in all Node container `.env` → `172.20.0.10`
- `REDIS_ADDR` in redis_exporter env → `redis://172.20.0.10:6379`
- Socket.io adapter pub/sub connection in `src/services/websocket.js`

---

### 4.2 SeaweedFS Master

```
Container name:    seaweedfs-master
Image:             chrislusf/seaweedfs:latest
Network:           eventsnapai-backend
Static IP:         172.20.0.20
Ports:
  9333 (master HTTP — expose to host for web UI access)
  19333 (master gRPC — internal only)
Restart:           always

Bind mounts:
  /mnt/user/appdata/eventsnapai/seaweedfs/master  →  /data

Command:
  weed master
    -port=9333
    -mdir=/data
    -defaultReplication=001
    -metricsPort=9324

Web UI access after deploy:
  http://<UNRAID_LAN_IP>:9333
  No login credentials — open by default.
  Shows: volume servers, storage capacity, cluster topology.

Verify after deploy:
  curl http://172.20.0.20:9333/cluster/status
  → JSON with leader and peers fields
```

---

### 4.3 SeaweedFS Volume Server

```
Container name:    seaweedfs-volume
Image:             chrislusf/seaweedfs:latest
Network:           eventsnapai-backend
Static IP:         172.20.0.21
Ports:
  8080 (volume HTTP — internal)
  18080 (volume gRPC — internal)
Restart:           always

Bind mounts:
  /mnt/user/appdata/eventsnapai/seaweedfs/volume1  →  /data

Command:
  weed volume
    -port=8080
    -dir=/data
    -max=50
    -mserver=172.20.0.20:9333
    -dataCenter=dc1
    -rack=rack1
    -metricsPort=9325

Cold tier setup (run after base deployment is stable):
  Designate a second volume server pointing at a slower array path.
  weed shell commands to move volumes older than 15 days to cold group.
  Configured via: weed shell → volume.configure.replication
  This is a post-launch operational task, not a launch blocker.

Verify after deploy:
  curl http://172.20.0.20:9333/vol/status
  → shows volume server registered with available space
```

---

### 4.4 SeaweedFS Filer

```
Container name:    seaweedfs-filer
Image:             chrislusf/seaweedfs:latest
Network:           eventsnapai-backend
Static IP:         172.20.0.22
Ports:
  8888 (filer HTTP — expose to host for web UI)
  18888 (filer gRPC — internal)
  8333 (S3-compatible API — expose to LAN, Node app calls this)
Restart:           always

Bind mounts:
  /mnt/user/appdata/eventsnapai/seaweedfs/filer  →  /etc/seaweedfs
  (filer.toml lives here — created before container starts)

Command:
  weed filer
    -port=8888
    -master=172.20.0.20:9333
    -s3
    -s3.port=8333
    -s3.config=/etc/seaweedfs/s3.json
    -metricsPort=9326

filer.toml (create at /mnt/user/appdata/eventsnapai/seaweedfs/filer/filer.toml
            before starting container):

  [postgres2]
  enabled = true
  hostname = "<VM-1 LAN IP>"
  port = 5432
  username = "seaweedfs_filer"
  password = "<password>"
  database = "seaweedfs_filer"
  sslmode = "disable"
  connection_max_idle = 2
  connection_max_open = 100
  connection_max_lifetime_seconds = 3600

s3.json (create at same path, controls S3 API access):
  {
    "identities": [
      {
        "name": "eventsnapai",
        "credentials": [
          {
            "accessKey": "<SEAWEEDFS_ACCESS_KEY>",
            "secretKey": "<SEAWEEDFS_SECRET_KEY>"
          }
        ],
        "actions": ["Read", "Write", "List", "Tagging", "Admin"]
      }
    ]
  }

Note on filer.toml Postgres:
  The filer uses Postgres to store its own file metadata (inode records).
  This is NOT your application database. It is SeaweedFS internal state.
  Create a separate database 'seaweedfs_filer' and user 'seaweedfs_filer'
  on VM-1 Postgres before starting this container.
  Your application database remains 'eventsnapai'.

Web UI access after deploy:
  http://<UNRAID_LAN_IP>:8888
  Filer web UI — browse stored files, check directory structure.
  No login credentials — open by default.

S3 API endpoint (what Node app uses):
  http://172.20.0.22:8333

Verify after deploy:
  curl http://172.20.0.22:8888/
  → filer web UI response

  aws s3 ls s3://eventsnapai \
    --endpoint-url http://172.20.0.22:8333 \
    --no-verify-ssl
  → empty or existing bucket listing
```

**What to update after SeaweedFS is running:**
- `SEAWEEDFS_MASTER` in `.env` → `172.20.0.20:9333`
- `SEAWEEDFS_FILER` in `.env` → `172.20.0.22:8888`
- `SEAWEEDFS_S3_ENDPOINT` in `.env` → `http://172.20.0.22:8333`
- `SEAWEEDFS_ACCESS_KEY` and `SEAWEEDFS_SECRET_KEY` → match s3.json
- AWS SDK `endpoint` in `src/services/seaweedfs.js` reads from env

---

### 4.5 Nginx

```
Container name:    nginx
Image:             nginx:1.25-alpine
Network:           eventsnapai-backend (and host for ports 80/443)
Ports:
  80:80   (exposed to host — HTTP entry point)
  443:443 (exposed to host — HTTPS, activate when Cloudflare connected)
Restart:           always

Bind mounts:
  /mnt/user/appdata/eventsnapai/nginx/conf  →  /etc/nginx/conf.d
  (create nginx.conf here before starting container)

nginx.conf content (save to /mnt/user/appdata/eventsnapai/nginx/conf/default.conf):

  upstream eventsnapai_http {
      least_conn;
      server <VM1_LAN_IP>:3001 max_fails=3 fail_timeout=30s weight=1;
      server <VM2_LAN_IP>:3001 max_fails=3 fail_timeout=30s weight=1;
      keepalive 32;
  }

  upstream eventsnapai_ws {
      least_conn;
      server <VM1_LAN_IP>:3001 max_fails=3 fail_timeout=30s;
      server <VM2_LAN_IP>:3001 max_fails=3 fail_timeout=30s;
  }

  limit_req_zone $binary_remote_addr zone=upload_zone:10m  rate=30r/m;
  limit_req_zone $binary_remote_addr zone=search_zone:10m  rate=10r/m;
  limit_req_zone $binary_remote_addr zone=general_zone:10m rate=120r/m;

  server {
      listen 80;
      server_name _;

      client_max_body_size      2000m;
      proxy_request_buffering   off;
      proxy_read_timeout        300s;
      proxy_send_timeout        300s;
      proxy_connect_timeout     10s;

      proxy_set_header Host              $host;
      proxy_set_header X-Real-IP         $remote_addr;
      proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;

      location /socket.io/ {
          proxy_pass             http://eventsnapai_ws;
          proxy_http_version     1.1;
          proxy_set_header Upgrade    $http_upgrade;
          proxy_set_header Connection "upgrade";
          proxy_read_timeout     86400s;
      }

      location /upload {
          limit_req zone=upload_zone burst=20 nodelay;
          proxy_pass http://eventsnapai_http;
      }

      location /search {
          limit_req zone=search_zone burst=5;
          proxy_pass http://eventsnapai_http;
      }

      location /stub_status {
          stub_status;
          allow 172.21.0.0/16;
          deny  all;
      }

      location / {
          limit_req zone=general_zone burst=30;
          proxy_pass http://eventsnapai_http;
      }
  }

Verify after deploy:
  curl http://<UNRAID_LAN_IP>/
  → Should reach Node app (once VMs are up)

  curl http://<UNRAID_LAN_IP>/stub_status
  → nginx stats (from monitoring network only)
```

---

### 4.6 Monitoring — Prometheus

```
If adding to existing Prometheus for Immich:
  Edit existing prometheus.yml
  Add the scrape_configs block from section 13 of this document.
  Reload: curl -X POST http://localhost:9090/-/reload

If running a dedicated Prometheus instance:
  Container name:    prometheus-eventsnapai
  Image:             prom/prometheus:v2.51.0
  Network:           eventsnapai-monitoring, eventsnapai-backend
  Static IP:         172.21.0.10
  Port:              9091:9090 (use 9091 to avoid conflict with Immich)
  Restart:           always

  Bind mounts:
    /mnt/user/appdata/eventsnapai/prometheus/data  →  /prometheus
    prometheus.yml  →  /etc/prometheus/prometheus.yml
```

---

### 4.7 Monitoring — Grafana

```
If adding to existing Grafana for Immich:
  Add new data sources:
    Prometheus (EventSnapAI): http://prometheus-eventsnapai:9091
    PostgreSQL: <VM1_LAN_IP>:5433 db=eventsnapai user=grafana_readonly
  Import dashboard JSON files from monitoring/grafana/ in the repo.
  Create a new folder "EventSnapAI" for the dashboards.

If running dedicated Grafana:
  Container name:    grafana-eventsnapai
  Image:             grafana/grafana:10.4.0
  Network:           eventsnapai-monitoring
  Port:              3001:3000 (use 3001 to avoid conflict)
  Restart:           always

  Bind mounts:
    /mnt/user/appdata/eventsnapai/grafana/data  →  /var/lib/grafana

  Env vars:
    GF_SECURITY_ADMIN_USER=admin
    GF_SECURITY_ADMIN_PASSWORD=<your_password>
    GF_SERVER_ROOT_URL=http://<UNRAID_LAN_IP>:3001
    GF_USERS_ALLOW_SIGN_UP=false
```

---

### 4.8 Exporters on Unraid

```
node_exporter:
  Container name:   node-exporter-unraid
  Image:            prom/node-exporter:v1.8.0
  Network:          eventsnapai-monitoring
  Port:             9100 (internal monitoring network)
  Bind mounts:
    /proc  →  /host/proc  (read-only)
    /sys   →  /host/sys   (read-only)
    /      →  /rootfs     (read-only)
  Command:
    --path.procfs=/host/proc
    --path.sysfs=/host/sys
    --path.rootfs=/rootfs
    --collector.filesystem.mount-points-exclude=^/(sys|proc|dev|host|etc)($$|/)

redis_exporter:
  Container name:   redis-exporter
  Image:            oliver006/redis_exporter:v1.62.0
  Network:          eventsnapai-monitoring, eventsnapai-backend
  Port:             9121
  Env vars:
    REDIS_ADDR=redis://172.20.0.10:6379

nginx_exporter:
  Container name:   nginx-exporter
  Image:            nginx/nginx-prometheus-exporter:1.1.0
  Network:          eventsnapai-monitoring, eventsnapai-backend
  Port:             9113
  Command:
    -nginx.scrape-uri=http://172.20.0.30:80/stub_status
  Note: nginx stub_status location must be configured first (see 4.5)

cadvisor:
  Container name:   cadvisor-unraid
  Image:            gcr.io/cadvisor/cadvisor:v0.49.1
  Network:          eventsnapai-monitoring
  Port:             8080
  Bind mounts:
    /            →  /rootfs        (read-only)
    /var/run     →  /var/run       (read-only)
    /sys         →  /sys           (read-only)
    /var/lib/docker  →  /var/lib/docker  (read-only)
    /dev/disk    →  /dev/disk      (read-only)
  Command: --housekeeping_interval=30s --docker_only=true
```

---

## 5. Ubuntu VM Deployments

Both VM-1 and VM-2 use a Docker Compose file for their containers.
This makes migration to Proxmox straightforward — copy the compose file and data directory.

All containers on a VM connect to an internal Docker bridge network `eventsnapai-vm`.
Selected ports are exposed to the VM's LAN IP for cross-service communication.

---

### 5.1 VM-1 Internal Docker Network

```
docker network create \
  --driver bridge \
  --subnet=10.10.1.0/24 \
  --gateway=10.10.1.1 \
  eventsnapai-vm
```

---

### 5.2 VM-1 — Postgres Primary

```
Container name:    postgres-primary
Image:             ankane/pgvector:v0.7.0
Network:           eventsnapai-vm
Port:              5432 (internal), expose 5432 to VM LAN IP for:
                   - SeaweedFS filer (filer.toml connection)
                   - Postgres streaming replication from VM-2
                   - postgres_exporter
Restart:           always

Bind mounts:
  /opt/eventsnapai/postgres/data  →  /var/lib/postgresql/data

Env vars:
  POSTGRES_DB=eventsnapai
  POSTGRES_USER=eventsnapai
  POSTGRES_PASSWORD=<strong_password>
  POSTGRES_INITDB_ARGS=--encoding=UTF8

Post-start setup (run once):
  1. Create seaweedfs filer database and user:
     CREATE DATABASE seaweedfs_filer;
     CREATE USER seaweedfs_filer WITH PASSWORD '<password>';
     GRANT ALL PRIVILEGES ON DATABASE seaweedfs_filer TO seaweedfs_filer;

  2. Create read-only user for Grafana:
     CREATE USER grafana_readonly WITH PASSWORD '<password>';
     GRANT CONNECT ON DATABASE eventsnapai TO grafana_readonly;
     GRANT USAGE ON SCHEMA public TO grafana_readonly;
     GRANT SELECT ON ALL TABLES IN SCHEMA public TO grafana_readonly;
     ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO grafana_readonly;

  3. Create replication user for VM-2 standby:
     CREATE USER replicator WITH REPLICATION LOGIN PASSWORD '<password>';

  4. Enable pgvector extension:
     \c eventsnapai
     CREATE EXTENSION IF NOT EXISTS vector;

  5. Run v2 migration SQL (see section 12).

postgresql.conf additions (append to /opt/eventsnapai/postgres/data/postgresql.conf):
  wal_level = replica
  max_wal_senders = 5
  wal_keep_size = 256MB
  listen_addresses = '*'
  shared_buffers = 8GB
  work_mem = 64MB
  max_connections = 100
  hnsw.ef_search = 64

pg_hba.conf additions:
  host  replication  replicator  <VM2_LAN_IP>/32  md5
  host  all          all         10.10.1.0/24     md5
  host  all          all         172.20.0.0/16    md5
  host  seaweedfs_filer  seaweedfs_filer  172.20.0.22/32  md5
```

---

### 5.3 VM-1 — PgBouncer (Read-Write)

```
Container name:    pgbouncer-rw
Image:             edoburu/pgbouncer:latest
Network:           eventsnapai-vm
Port:              5433 (expose to VM LAN IP — Node app and workers connect here)
Restart:           always

Bind mounts:
  /opt/eventsnapai/pgbouncer/pgbouncer-rw.ini  →  /etc/pgbouncer/pgbouncer.ini

pgbouncer-rw.ini content:
  [databases]
  eventsnapai = host=postgres-primary port=5432 dbname=eventsnapai

  [pgbouncer]
  listen_addr = 0.0.0.0
  listen_port = 5433
  auth_type = md5
  auth_file = /etc/pgbouncer/userlist.txt
  pool_mode = transaction
  max_client_conn = 200
  default_pool_size = 20
  min_pool_size = 5
  reserve_pool_size = 5
  server_idle_timeout = 600
  log_connections = 0
  log_disconnections = 0

userlist.txt (same bind mount directory):
  "eventsnapai" "<md5_of_password>"
  "grafana_readonly" "<md5_of_password>"
```

---

### 5.4 VM-2 — Postgres Standby

```
Container name:    postgres-standby
Image:             ankane/pgvector:v0.7.0
Network:           eventsnapai-vm
Port:              5432 (internal), 5432 exposed to VM LAN IP
Restart:           always

Bind mounts:
  /opt/eventsnapai/postgres/data  →  /var/lib/postgresql/data

Initial setup — run pg_basebackup from VM-2 host (not inside container):
  docker run --rm \
    -e PGPASSWORD=<replicator_password> \
    -v /opt/eventsnapai/postgres/data:/var/lib/postgresql/data \
    ankane/pgvector:v0.7.0 \
    pg_basebackup \
      -h <VM1_LAN_IP> \
      -U replicator \
      -D /var/lib/postgresql/data \
      -P -Xs -R
  The -R flag writes standby.signal and recovery connection settings automatically.

postgresql.conf additions on standby:
  hot_standby = on
  max_connections = 100
  shared_buffers = 8GB
  work_mem = 64MB
  hnsw.ef_search = 64

Verify replication after both are running:
  On VM-1: SELECT client_addr, state, sent_lsn, replay_lsn
           FROM pg_stat_replication;
  → Should show VM-2 IP with state='streaming'

  On VM-2: SELECT pg_is_in_recovery();
  → t (true = standby)

  Replication lag check:
  SELECT EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())) AS lag_seconds;
```

---

### 5.5 VM-2 — PgBouncer (Read-Only)

```
Container name:    pgbouncer-ro
Image:             edoburu/pgbouncer:latest
Network:           eventsnapai-vm
Port:              5433 (expose to VM LAN IP)
Restart:           always

pgbouncer-ro.ini content:
  [databases]
  eventsnapai = host=postgres-standby port=5432 dbname=eventsnapai

  [pgbouncer]
  listen_addr = 0.0.0.0
  listen_port = 5433
  auth_type = md5
  auth_file = /etc/pgbouncer/userlist.txt
  pool_mode = transaction
  max_client_conn = 200
  default_pool_size = 20
  server_idle_timeout = 600
```

---

### 5.6 VM-1 and VM-2 — Node App Container

```
Container name:    eventsnapai-app
Image:             eventsnapai-app:latest   (custom build)
Network:           eventsnapai-vm
Port:
  3001 (expose to VM LAN IP — Nginx routes here)
  9091 (Prometheus metrics — expose to VM LAN IP for Prometheus scrape)
Restart:           always

Bind mounts:
  /opt/eventsnapai/tmp  →  /tmp/evsnap   (upload temp files)
  .env                  →  /app/.env     (or pass all as Docker env vars in Portainer)

The Node app process:
  - Serves all HTTP routes (unchanged routes + updated upload/search/diagnostics)
  - Runs Socket.io WebSocket server on same port :3001
  - Socket.io uses Redis pub/sub adapter (db:3) for cross-VM WebSocket routing
  - Exposes Prometheus metrics at GET /metrics on port 9091
  - Background interval every 10s: checks replica lag, writes to Redis db:4
```

---

### 5.7 VM-1 and VM-2 — Worker Container

```
Container name:    eventsnapai-worker-compress  (WORKER_TYPE=compression)
                   eventsnapai-worker-index     (WORKER_TYPE=indexing)
Image:             eventsnapai-worker:latest   (custom build, same repo)
Network:           eventsnapai-vm
Ports:
  9092 (compression worker metrics — expose to VM LAN IP)
  9093 (indexing worker metrics — expose to VM LAN IP)
Restart:           always

Bind mounts:
  /opt/eventsnapai/tmp  →  /tmp/evsnap
  .env.worker           →  /app/.env

Note: Two worker container instances per VM.
      Each is the same image with different WORKER_TYPE env var.
      Both share the same /tmp/evsnap bind mount.
```

---

### 5.8 VM-1 and VM-2 — InsightFace Sidecar

```
Container name:    insightface-sidecar
Image:             eventsnapai-insightface:latest   (custom build)
Network:           eventsnapai-vm
Port:              8001 (internal — only Node app and worker access this)
                   expose 8001 to VM LAN IP for Prometheus scrape of /metrics
Restart:           always

Bind mounts:
  /opt/eventsnapai/models  →  /models/insightface
  (buffalo_l models pre-downloaded at image build time,
   volume mount overlays so models survive container rebuilds.
   First build takes ~5 min to download 500MB. Subsequent rebuilds instant.)

Env vars:
  CTX_ID=-1             (CPU mode — CHANGE_IN_PROD: 0 for GPU)
  UVICORN_WORKERS=2     (CHANGE_IN_PROD: 4 for GPU node)
  DET_THRESHOLD=0.5
  DET_SIZE=640
  INSIGHTFACE_MODEL_DIR=/models/insightface
```

---

### 5.9 VM-1 and VM-2 — Exporters

```
node_exporter:
  Container name:  node-exporter
  Image:           prom/node-exporter:v1.8.0
  Network:         host (needs host network for accurate metrics)
  Port:            9100 (expose to VM LAN IP)
  Bind mounts:     /proc /sys / (read-only, standard node_exporter mounts)

cadvisor:
  Container name:  cadvisor
  Image:           gcr.io/cadvisor/cadvisor:v0.49.1
  Network:         bridge
  Port:            8080 (expose to VM LAN IP)
  Bind mounts:     standard cadvisor mounts
  Command:         --housekeeping_interval=30s --docker_only=true

postgres_exporter:
  Container name:  postgres-exporter
  Image:           quay.io/prometheuscommunity/postgres-exporter:v0.15.0
  Network:         eventsnapai-vm
  Port:            9187 (expose to VM LAN IP)
  Env vars:
    DATA_SOURCE_NAME=postgresql://eventsnapai:<password>@pgbouncer-rw:5433/eventsnapai?sslmode=disable
    (VM-2: point at pgbouncer-ro:5433)
```

---

## 6. Environment Variables Master List

One `.env` file per VM. Portainer passes these as stack environment variables.
Variables marked `# CHANGE_IN_PROD` must be updated before production launch.

```env
# ── Server ──────────────────────────────────────────────────────────────────
NODE_ENV=sandbox                         # CHANGE_IN_PROD: production
PORT=3001
LOG_LEVEL=info                           # CHANGE_IN_PROD: warn

# ── Auth (unchanged from current project) ───────────────────────────────────
ADMIN_API_KEY=replace_with_long_random_string
DELETE_API_KEY=replace_with_long_random_string
JWT_SECRET=replace_with_long_random_string
JWT_EXPIRES_IN=6h

# ── Postgres ─────────────────────────────────────────────────────────────────
POSTGRES_PRIMARY_URL=postgresql://eventsnapai:<pw>@<VM1_LAN_IP>:5433/eventsnapai
POSTGRES_REPLICA_URL=postgresql://eventsnapai:<pw>@<VM2_LAN_IP>:5433/eventsnapai
POSTGRES_REPLICA_LAG_THRESHOLD_MS=2000  # CHANGE_IN_PROD: 500
REPLICA_LAG_CACHE_TTL_S=10

# ── Redis ────────────────────────────────────────────────────────────────────
REDIS_HOST=172.20.0.10
REDIS_PORT=6379
REDIS_PASSWORD=                          # CHANGE_IN_PROD: set strong password
REDIS_DB_COMPRESS=0
REDIS_DB_INDEX=1
REDIS_DB_DEDUP=2
REDIS_DB_SOCKETIO=3
REDIS_DB_LAG=4
DEDUP_TTL_SECONDS=259200                 # 72 hours

# ── SeaweedFS ────────────────────────────────────────────────────────────────
SEAWEEDFS_MASTER=172.20.0.20:9333
SEAWEEDFS_FILER=172.20.0.22:8888
SEAWEEDFS_S3_ENDPOINT=http://172.20.0.22:8333
SEAWEEDFS_ACCESS_KEY=replace_with_key_from_s3_json
SEAWEEDFS_SECRET_KEY=replace_with_secret_from_s3_json
SEAWEEDFS_REGION=us-east-1
SEAWEEDFS_DEFAULT_BUCKET=eventsnapai
PRESIGNED_URL_EXPIRY=21600               # 6 hours

# ── SeaweedFS folder structure ───────────────────────────────────────────────
# Stored as: {bucket}/{eventId}/photo_{photoId}.jpg
#            {bucket}/{eventId}/thumbs/thumb_{photoId}.jpg
# This is enforced in seaweedfs.js service, not configurable at runtime.

# ── InsightFace ──────────────────────────────────────────────────────────────
INSIGHTFACE_URL=http://insightface-sidecar:8001
FACE_DISTANCE_THRESHOLD=0.40             # CHANGE_IN_PROD: tune after real-event data
INSIGHTFACE_MODEL_DIR=/models/insightface
CTX_ID=-1                               # CHANGE_IN_PROD: 0 for GPU
UVICORN_WORKERS=2                       # CHANGE_IN_PROD: 4 for GPU node

# ── Workers ──────────────────────────────────────────────────────────────────
WORKER_TYPE=compression                  # or: indexing (set per container)
COMPRESSION_CONCURRENCY=3               # CHANGE_IN_PROD: 6 with GPU present
INDEXING_CONCURRENCY=2                  # CHANGE_IN_PROD: 8 with GPU
WORKER_TEMP_DIR=/tmp/evsnap
WORKER_TEMP_MAX_AGE_HOURS=2
WORKER_MAX_RETRIES=3
WORKER_BACKOFF_DELAY_MS=5000

# ── Upload ───────────────────────────────────────────────────────────────────
UPLOAD_MAX_FILES_PER_BATCH=50
UPLOAD_MAX_FILE_SIZE_MB=40
UPLOAD_MAX_QUEUE_DEPTH=500              # CHANGE_IN_PROD: 2000

# ── Quality presets ──────────────────────────────────────────────────────────
QUALITY_STANDARD_WIDTH=1920
QUALITY_STANDARD_JPEG=82
QUALITY_HIGH_WIDTH=2800
QUALITY_HIGH_JPEG=92
QUALITY_PREMIUM_JPEG=100
QUALITY_PREMIUM_THUMB_JPEG=85
# Premium: no sharp compression pass — direct SeaweedFS stream
# Thumbnail always generated via sharp regardless of preset

# ── Cold tier ────────────────────────────────────────────────────────────────
COLD_TIER_AFTER_DAYS=15                 # CHANGE_IN_PROD: adjust to storage cost

# ── SMTP ─────────────────────────────────────────────────────────────────────
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_gmail@gmail.com
SMTP_PASS=your_gmail_app_password
ALERT_EMAIL_TO=info@raidcloud.in
ALERT_EMAIL_COMPRESS_FAILURE=true       # CHANGE_IN_PROD: false at high volume
ALERT_EMAIL_INDEX_FAILURE=true          # CHANGE_IN_PROD: false at high volume

# ── Observability ─────────────────────────────────────────────────────────────
PROMETHEUS_METRICS_PORT=9091            # Node app (same for both VMs)
WORKER_METRICS_PORT=9092                # compression worker
# indexing worker uses 9093 — set as WORKER_METRICS_PORT in that container

# ── Socket.io ────────────────────────────────────────────────────────────────
SOCKETIO_REDIS_DB=3                     # same as REDIS_DB_SOCKETIO

# ── Bull Board ───────────────────────────────────────────────────────────────
BULL_BOARD_USERNAME=admin
BULL_BOARD_PASSWORD=replace_with_password
BULL_BOARD_BASE_PATH=/admin/queues

# ── CORS ─────────────────────────────────────────────────────────────────────
ALLOWED_ORIGINS=http://localhost:3001   # CHANGE_IN_PROD: https://yourdomain.com
```

---

## 7. Pipeline 1 — Ingestion

```
INGESTION PIPELINE
──────────────────

Manager browser (POST /upload/:eventId, multipart, up to 50 files)
  │
  ▼
Nginx (proxy_request_buffering off — raw stream passes to Node)
  │
  ▼
Node.js upload route
  │
  ├── multer diskStorage
  │     destination: /tmp/evsnap/{sessionId}/
  │     streams HTTP body directly to disk (zero RAM for file content)
  │     concurrent with stream: crypto.createHash('sha256').pipe(writeStream)
  │     by multer.done: file on disk + hash computed, no second read needed
  │
  ├── PER FILE loop:
  │
  │   ├── Redis dedup check (db:2)
  │   │     key format: d:{eventId}:{sha256hex}
  │   │     SETNX with TTL 259200 (72h)
  │   │     HIT  → delete temp file → emit WS 'upload:duplicate' → skip
  │   │     MISS → continue
  │   │
  │   ├── Postgres authoritative dedup
  │   │     INSERT INTO indexed_photos(event_id, sha256_hash, ...)
  │   │     ON CONFLICT (event_id, sha256_hash) DO NOTHING RETURNING id
  │   │     NO ROWS → duplicate caught at DB level → delete temp → skip
  │   │     ROW RETURNED → photo_id assigned → continue
  │   │
  │   ├── Enqueue compression job → Redis db:0
  │   │     payload: { eventId, photoId, tempPath, qualityPreset,
  │   │                managerId, sessionId, bucket }
  │   │
  │   └── Emit Socket.io 'upload:accepted' → manager browser (via Redis pub/sub)
  │         payload: { photoId, filename, sessionId }
  │
  └── Respond HTTP 202 immediately
        { results: [{filename, status, photoId, jobId}] }
        Manager browser receives this + real-time WS events per file.

ON TEMP FILE:
  - Retained until compression worker confirms SeaweedFS write
  - Safety cron: delete /tmp/evsnap/** older than 2 hours (via node-cron in worker)
  - On 3 compression retries exhausted: move to /tmp/evsnap/failed/, fire email

DEDUP KEY DESIGN:
  d:{eventId}:{sha256hex}          ~80 chars
  1M entries × 80 bytes = ~80 MB Redis memory
  72h TTL → entries expire automatically
  Same photo in different event: different key (eventId differs) → allowed
```

**Grafana panels — Ingestion:**
```
upload_stream_mbps            rate of http_request_size_bytes_total{route="/upload"}
upload_files_accepted_total   counter per manager_id, event_id
upload_files_rejected_total   counter per reason (redis_dedup/postgres_dedup/error)
upload_sessions_active        gauge
dedup_redis_hit_rate          dedup_redis_hits / dedup_checks ratio panel
dedup_abuse_panel             files_rejected_total{manager_id} over 24h (abuse detection)
ws_connections_manager        gauge of Socket.io connections with manager role
temp_disk_usage               node_filesystem_avail_bytes{mountpoint="/tmp/evsnap"}
```

---

## 8. Pipeline 2 — Compression

```
COMPRESSION PIPELINE
────────────────────

BullMQ worker (Redis db:0, WORKER_TYPE=compression)
  │
  ├── Pick job: { eventId, photoId, tempPath, qualityPreset, managerId, sessionId }
  │
  ├── Emit Socket.io 'compress:start' → manager session
  │
  ├── QUALITY BRANCH:
  │
  │   ┌── STANDARD or HIGH ────────────────────────────────────────────────────┐
  │   │   fs.createReadStream(tempPath)                                        │
  │   │     .pipe(sharp()                                                      │
  │   │       STANDARD: .resize(1920, 1920, {fit:'inside'}).jpeg({quality:82}) │
  │   │       HIGH:     .resize(2800, 2800, {fit:'inside'}).jpeg({quality:92}) │
  │   │     )                                                                  │
  │   │     .pipe(SeaweedFS S3 Upload stream)                                  │
  │   │   destination: {bucket}/{eventId}/photo_{photoId}.jpg                  │
  │   │   Peak RAM per job: ~5 MB (one S3 multipart chunk)                     │
  │   └───────────────────────────────────────────────────────────────────────┘
  │
  │   ┌── PREMIUM ─────────────────────────────────────────────────────────────┐
  │   │   fs.createReadStream(tempPath)                                        │
  │   │     .pipe(SeaweedFS S3 Upload stream directly — NO sharp transform)    │
  │   │   destination: {bucket}/{eventId}/photo_{photoId}.jpg                  │
  │   │   Fastest path: pure I/O, zero CPU for compression                     │
  │   └───────────────────────────────────────────────────────────────────────┘
  │
  ├── THUMBNAIL (all presets including premium):
  │     fs.createReadStream(tempPath)
  │       .pipe(sharp().resize(400, 400, {fit:'inside'}).jpeg({quality:85}))
  │       .pipe(SeaweedFS S3 Upload stream)
  │     destination: {bucket}/{eventId}/thumbs/thumb_{photoId}.jpg
  │
  ├── SeaweedFS ETag dedup check
  │     ETag returned by S3 API after write = MD5 of content
  │     key: etag:{eventId}:{etag_hex}   TTL: 7 days
  │     Redis SETNX on db:2
  │     HIT  → delete just-uploaded object from SeaweedFS
  │           → update indexed_photos.compressed_url to existing URL
  │           → emit 'compress:duplicate'
  │     MISS → continue
  │
  ├── UPDATE indexed_photos SET
  │     compressed_url = '{bucket}/{eventId}/photo_{photoId}.jpg'
  │     thumbnail_url  = '{bucket}/{eventId}/thumbs/thumb_{photoId}.jpg'
  │     compression_status = 'done'
  │     quality_preset = qualityPreset
  │
  ├── INSERT job_tracking row: step=COMPRESSED, status=done
  │
  ├── Delete temp file from /tmp/evsnap/
  │
  ├── Enqueue indexing job → Redis db:1
  │     payload: { eventId, photoId, compressedObjectKey, managerId, sessionId }
  │
  └── Emit Socket.io 'compress:done' → manager session
        payload: { photoId, thumbnailUrl, sessionId }

ON FAILURE after 3 retries:
  UPDATE indexed_photos SET compression_status='failed'
  INSERT job_tracking: step=COMPRESSED, status=failed, error_msg=...
  Send email via mailer.js to ALERT_EMAIL_TO
    Subject: [EventSnapAI] Compression failed — {filename}
    Body: manager, event, filename, error, admin retry URL
  Emit Socket.io 'compress:failed' → manager session
  Move temp file to /tmp/evsnap/failed/{photoId}/
```

**Grafana panels — Compression:**
```
compress_queue_depth          bullmq_queue_waiting{queue="compress"}
compress_queue_active         bullmq_queue_active{queue="compress"}
compress_queue_failed         bullmq_queue_failed{queue="compress"}
compress_duration_p95         histogram compress_duration_seconds{preset}
compress_ratio                (input_bytes - output_bytes) / input_bytes
seaweedfs_writes_per_min      seaweedfs_writes_total rate(1m)
seaweedfs_write_errors        seaweedfs_write_errors_total rate(1m)
seaweedfs_etag_dedups         seaweedfs_etag_dedup_total rate(1m)
postgres_writes_indexed       pg_stat_user_tables_n_tup_ins{table="indexed_photos"}
sharp_cpu_usage               process_cpu_seconds_total{job="compression_worker"}
```

---

## 9. Pipeline 3 — Face Indexing

```
FACE INDEXING PIPELINE
──────────────────────

BullMQ worker (Redis db:1, WORKER_TYPE=indexing)
  │
  ├── Pick job: { eventId, photoId, compressedObjectKey, managerId, sessionId }
  │
  ├── Emit Socket.io 'index:start' → manager session
  │
  ├── Fetch compressed image from SeaweedFS
  │     GET http://172.20.0.22:8888/{compressedObjectKey}
  │     (direct filer HTTP — faster than S3 presign for internal access)
  │     Buffer in RAM (~2-9 MB depending on quality preset)
  │
  ├── POST insightface-sidecar:8001/detect
  │     body: multipart image buffer
  │     response: { faces: [{face_index, bbox, det_score, embedding[512]}] }
  │
  ├── IF faces.length === 0:
  │     UPDATE indexed_photos SET index_status='no_faces', face_count=0
  │     INSERT job_tracking: step=INDEXED, status=no_faces
  │     Emit 'index:no_faces' (photo stored, not face-searchable)
  │     → photo appears in generalPhotos for all visitors
  │     → EXIT
  │
  ├── FOR EACH face detected:
  │     INSERT INTO face_embeddings
  │       (event_id, photo_id, face_index, embedding::vector(512))
  │     ON CONFLICT (photo_id, face_index) DO UPDATE SET embedding = EXCLUDED.embedding
  │
  ├── UPDATE indexed_photos SET
  │     index_status='indexed'
  │     face_count=N
  │
  ├── INSERT job_tracking: step=INDEXED, status=done
  │
  └── Emit Socket.io 'index:done' → manager session
        payload: { photoId, faceCount, sessionId }
        Manager UI: all three status dots now green ✓

ON FAILURE after 3 retries:
  UPDATE indexed_photos SET index_status='index_failed'
  INSERT job_tracking: step=INDEXED, status=failed, error_msg=...
  Send email via mailer.js to ALERT_EMAIL_TO (if ALERT_EMAIL_INDEX_FAILURE=true)
    Subject: [EventSnapAI] Face indexing failed — {filename}
  Emit Socket.io 'index:failed' → manager session

INSIGHTFACE SIDECAR DETAIL:
  buffalo_l pack — two ONNX models used:
    det_10g.onnx    → SCRFD face detector (runs first on full image)
    w600k_r50.onnx  → ArcFace ResNet-50 recognition (runs per detected face)
  Models loaded at container start, held in memory.
  CPU inference: ~150-400ms per photo (3-5 faces)
  GPU inference (CTX_ID=0): ~30-80ms per photo
  Models volume-mounted: survive container rebuilds without re-download
```

**Grafana panels — Indexing:**
```
index_queue_depth             bullmq_queue_waiting{queue="index"}
index_queue_active            bullmq_queue_active{queue="index"}
index_queue_failed            bullmq_queue_failed{queue="index"}   ALERT if > 5
index_success_rate            indexed / (indexed + failed) %
insightface_inference_p95     histogram insightface_inference_ms
faces_per_photo               histogram faces_detected_per_photo
photos_no_faces_rate          photos_no_faces_total rate(1m)
embeddings_stored_per_min     embeddings_stored_total rate(1m)
pgvector_insert_latency_p95   histogram pgvector_insert_ms
insightface_cpu               container_cpu_usage_seconds_total{name="insightface"}
insightface_memory            container_memory_usage_bytes{name="insightface"}
```

---

## 10. Pipeline 4 — Delivery

```
DELIVERY PIPELINE
─────────────────

Visitor journey:
  1. Scans QR code at event
  2. Opens visitor portal URL (event-scoped)
  3. Takes selfie or uploads photo
  4. Sees animated scan overlay (CSS keyframes, no JS library)
  5. Results appear in-place, no page reload

VISITOR AUTH:
  GET /events/:eventId/token
    → verifies event is active, visitor access enabled
    → returns visitor JWT { eventId, role:'visitor', exp: 6h }
    → stored in sessionStorage (not localStorage)
    → sessionStorage cleared on page close/refresh → back to scan screen (correct)

SEARCH FLOW:
  POST /search
  Header: Authorization: Bearer <visitor_jwt>
  Body:   multipart, field: selfie (image)
    │
    ├── JWT verify (stateless, no DB lookup — same JWT_SECRET on both VMs)
    │     extract eventId from token payload
    │
    ├── multer memoryStorage (selfie only — 1 file, ~2-5 MB, held in RAM)
    │     RAM released immediately after response
    │
    ├── POST insightface-sidecar:8001/embed
    │     body: selfie buffer
    │     response: { embedding[512], det_score }
    │     FAIL (no face): HTTP 422 → frontend shows "No face detected" error state
    │
    ├── REPLICA LAG CHECK (Node background job, cached in Redis db:4)
    │     key: replica_lag:{vmId}   TTL: 15s   value: lag_ms
    │     IF lag_ms < POSTGRES_REPLICA_LAG_THRESHOLD_MS (2000ms):
    │       query → POSTGRES_REPLICA_URL (VM-2 PgBouncer :5433 → standby)
    │     ELSE (standby behind or key missing):
    │       query → POSTGRES_PRIMARY_URL (VM-1 PgBouncer :5433 → primary)
    │     This means VM-1 handles searches too when idle — load not hard-coded to VM-2
    │
    ├── pgvector ANN search
    │     SELECT photo_id, (embedding <=> $2::vector) AS distance
    │     FROM   face_embeddings
    │     WHERE  event_id = $1
    │       AND  (embedding <=> $2::vector) <= $3
    │     ORDER  BY embedding <=> $2::vector
    │     LIMIT  100
    │     (no cap on returned results — all matches within threshold returned)
    │
    ├── Deduplicate photo_ids
    │
    ├── Fetch indexed_photos metadata
    │     (checks is_favorite for each photoId)
    │
    ├── Generate SeaweedFS presigned URLs
    │     http://172.20.0.22:8333/{bucket}/{eventId}/photo_{photoId}.jpg
    │     expiry: PRESIGNED_URL_EXPIRY (21600s = 6h, matches JWT)
    │
    └── Return JSON { myPhotos, generalPhotos, favoritePhotos }
          same response shape as current — frontend unchanged

FRONTEND CHANGES (visitor portal only):
  scan animation overlay:
    - div#scan-overlay (hidden by default)
    - CSS: position:fixed, full viewport, z-index:9999, dark semi-transparent bg
    - inner: selfie preview + CSS pulsing ring animation (@keyframes)
    - text: "Finding your photos..."
    - show on fetch start, hide on fetch resolve or reject

  result rendering:
    - existing renderResults() function called on fetch resolve
    - results injected into existing DOM container (no page reload)
    - on reject: hide overlay, show existing error state

  no WebSocket for delivery — synchronous fetch with loading state is correct
  search completes in 300-800ms, loading animation covers this window
```

**Grafana panels — Delivery:**
```
visitors_active               gauge (Socket.io connections with visitor JWT)
searches_per_min              searches_total rate(1m)
search_latency_p50_p95_p99    histogram search_duration_ms
selfie_no_face_failures       selfie_no_face_total rate(1m)
search_results_count          histogram search_results_returned
pgvector_query_time_p95       histogram pgvector_search_ms
replica_lag_seconds           replica_lag:{vmId} from Redis (panel showing live lag)
presign_generation_ms         histogram presign_duration_ms
searches_by_event             searches_total{event_id} for top events panel
```

---

## 11. Authentication and Session Strategy

```
JWT STRATEGY — STATELESS (no change from current)
───────────────────────────────────────────────────

All JWTs signed with JWT_SECRET.
JWT_SECRET is identical across VM-1 and VM-2 (same .env value).
Any VM can verify any JWT independently — no session store needed.

JWT payload includes:
  { userId, role, eventId (visitors only), iat, exp }

The one live DB check in auth.js:
  SELECT is_active FROM users WHERE id = $1
  This goes to POSTGRES_PRIMARY_URL (via PgBouncer).
  Consistent across VMs because both hit the same primary.

Result: manager logged in on VM-1, next request hits VM-2 → fully authenticated.
        No sticky sessions, no session replication, no Redis session store needed.

WEBSOCKET SESSIONS — REDIS PUB/SUB (new)
─────────────────────────────────────────

Socket.io with @socket.io/redis-adapter on Redis db:3.

Manager browser connects:
  ws://nginx → least_conn → VM-1 Node process
  Socket registered: socket.id → manager session

VM-2 compression worker finishes a photo:
  worker.publish('ws:events', { sessionId, event:'compress:done', data:{...} })

Socket.io Redis adapter on VM-1 receives pub/sub message:
  finds socket by sessionId → emits to manager browser

VM-1 and VM-2 both subscribe to the same pub/sub channel.
VM that does not hold the socket receives message, finds no socket, discards silently.
This is the Socket.io Redis adapter's native behaviour.

Session ID:
  Assigned at manager login.
  Stored in sessionStorage on manager browser.
  Sent as Socket.io auth token on connect.
  All job payloads carry sessionId so workers know which manager to notify.

WHY NOT STICKY SESSIONS:
  Sticky sessions (ip_hash in nginx) would route a manager's HTTP upload
  always to the same VM. This defeats load balancing if one VM is overloaded.
  JWT statelessness + Redis pub/sub for WebSocket achieves the same UX
  without sacrificing load distribution.
```

---

## 12. Database Schema Changes

Additive only. No existing tables or columns removed.

```sql
-- Run on VM-1 Postgres PRIMARY after base setup.
-- Replication propagates all changes to standby automatically.

-- 1. pgvector extension (required before face_embeddings table)
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Add columns to existing indexed_photos table
ALTER TABLE indexed_photos
  ADD COLUMN IF NOT EXISTS index_status      TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS face_count        INTEGER,
  ADD COLUMN IF NOT EXISTS quality_preset    TEXT NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN IF NOT EXISTS compression_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS compressed_url    TEXT,
  ADD COLUMN IF NOT EXISTS thumbnail_url     TEXT,
  ADD COLUMN IF NOT EXISTS bucket_name       TEXT,
  ADD COLUMN IF NOT EXISTS object_key        TEXT;

-- index_status values:   pending | processing | indexed | no_faces | index_failed
-- compression_status:    pending | processing | done | upload_failed

-- 3. Add unique constraint for event-scoped dedup (if not already present)
ALTER TABLE indexed_photos
  ADD CONSTRAINT IF NOT EXISTS uq_indexed_photos_event_hash
  UNIQUE (event_id, sha256_hash);

-- 4. Face embeddings table — one row per detected face per photo
CREATE TABLE IF NOT EXISTS face_embeddings (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID        NOT NULL REFERENCES events(id)  ON DELETE CASCADE,
  photo_id    UUID        NOT NULL REFERENCES indexed_photos(id) ON DELETE CASCADE,
  face_index  INTEGER     NOT NULL DEFAULT 0,
  embedding   vector(512) NOT NULL,
  crop_url    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (photo_id, face_index)
);

-- 5. HNSW index for cosine ANN search (cosine matches ArcFace training metric)
CREATE INDEX IF NOT EXISTS idx_face_embeddings_hnsw
  ON face_embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- B-tree index on event_id — Postgres uses this BEFORE the HNSW scan
CREATE INDEX IF NOT EXISTS idx_face_embeddings_event
  ON face_embeddings (event_id);

-- 6. Job tracking table — pipeline progress per file per session
CREATE TABLE IF NOT EXISTS job_tracking (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  TEXT        NOT NULL,
  manager_id  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id    UUID        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  photo_id    UUID        REFERENCES indexed_photos(id) ON DELETE SET NULL,
  bullmq_job_id TEXT,
  filename    TEXT        NOT NULL,
  step        TEXT        NOT NULL,   -- INGESTED | COMPRESSED | INDEXED
  status      TEXT        NOT NULL,   -- pending | processing | done | duplicate | failed | no_faces
  error_msg   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_tracking_session  ON job_tracking(session_id);
CREATE INDEX IF NOT EXISTS idx_job_tracking_event    ON job_tracking(event_id);
CREATE INDEX IF NOT EXISTS idx_job_tracking_status   ON job_tracking(status);
CREATE INDEX IF NOT EXISTS idx_job_tracking_manager  ON job_tracking(manager_id);

-- 7. Grafana read-only user (run once)
CREATE USER IF NOT EXISTS grafana_readonly WITH PASSWORD '<password>';
GRANT CONNECT ON DATABASE eventsnapai TO grafana_readonly;
GRANT USAGE ON SCHEMA public TO grafana_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO grafana_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO grafana_readonly;

-- 8. SeaweedFS filer database (run once, in seaweedfs_filer context)
-- \c seaweedfs_filer
-- (SeaweedFS creates its own tables on first connect — no manual schema needed)

-- Verify pgvector installed:
-- SELECT extversion FROM pg_extension WHERE extname = 'vector';
-- Verify HNSW index:
-- SELECT indexname FROM pg_indexes WHERE tablename = 'face_embeddings';
```

---

## 13. Observability Stack

### Prometheus scrape_configs

Add to existing prometheus.yml (or new config if separate instance):

```yaml
scrape_configs:
  # ── Unraid bare metal ────────────────────────────────────────────────────
  - job_name: 'unraid_node'
    static_configs:
      - targets: ['172.21.0.1:9100']    # node_exporter on Unraid host
    labels:
      host: unraid

  - job_name: 'unraid_cadvisor'
    static_configs:
      - targets: ['172.21.0.1:8080']

  - job_name: 'redis'
    static_configs:
      - targets: ['172.21.0.1:9121']    # redis_exporter

  - job_name: 'nginx'
    static_configs:
      - targets: ['172.21.0.1:9113']    # nginx_exporter

  - job_name: 'seaweedfs_master'
    static_configs:
      - targets: ['172.20.0.20:9324']   # weed master native /metrics

  - job_name: 'seaweedfs_volume'
    static_configs:
      - targets: ['172.20.0.21:9325']

  - job_name: 'seaweedfs_filer'
    static_configs:
      - targets: ['172.20.0.22:9326']

  # ── Ubuntu VM-1 ──────────────────────────────────────────────────────────
  - job_name: 'vm1_node'
    static_configs:
      - targets: ['<VM1_LAN_IP>:9100']
    labels:
      host: vm1

  - job_name: 'vm1_cadvisor'
    static_configs:
      - targets: ['<VM1_LAN_IP>:8080']

  - job_name: 'vm1_postgres'
    static_configs:
      - targets: ['<VM1_LAN_IP>:9187']
    labels:
      role: primary

  - job_name: 'vm1_app'
    static_configs:
      - targets: ['<VM1_LAN_IP>:9091']
    labels:
      service: node_app

  - job_name: 'vm1_worker_compress'
    static_configs:
      - targets: ['<VM1_LAN_IP>:9092']

  - job_name: 'vm1_worker_index'
    static_configs:
      - targets: ['<VM1_LAN_IP>:9093']

  - job_name: 'vm1_insightface'
    static_configs:
      - targets: ['<VM1_LAN_IP>:8001']

  # ── Ubuntu VM-2 ──────────────────────────────────────────────────────────
  - job_name: 'vm2_node'
    static_configs:
      - targets: ['<VM2_LAN_IP>:9100']
    labels:
      host: vm2

  - job_name: 'vm2_cadvisor'
    static_configs:
      - targets: ['<VM2_LAN_IP>:8080']

  - job_name: 'vm2_postgres'
    static_configs:
      - targets: ['<VM2_LAN_IP>:9187']
    labels:
      role: standby

  - job_name: 'vm2_app'
    static_configs:
      - targets: ['<VM2_LAN_IP>:9091']

  - job_name: 'vm2_worker_compress'
    static_configs:
      - targets: ['<VM2_LAN_IP>:9092']

  - job_name: 'vm2_worker_index'
    static_configs:
      - targets: ['<VM2_LAN_IP>:9093']

  - job_name: 'vm2_insightface'
    static_configs:
      - targets: ['<VM2_LAN_IP>:8001']
```

### Grafana Dashboard Rows

```
ROW 1 — System Health (all hosts)
  CPU %               node_cpu_seconds_total rate per host
  RAM used/total      node_memory_MemAvailable / node_memory_MemTotal
  Disk I/O            node_disk_read/write_bytes_total rate
  Network in/out      node_network_receive/transmit_bytes_total rate
  CPU temperature     node_hwmon_temp_celsius{chip,sensor}
  Storage used        seaweedfs volume used bytes
  Storage growth      deriv(seaweedfs_volume_used[24h])
  All services up     up{job=~".*"} — red panel if any = 0

ROW 2 — Ingestion
  Upload MB/s per manager    rate(http_request_size_bytes_total{route="/upload"}[1m])
  Files accepted/min         rate(upload_files_accepted_total[1m])
  Files rejected/min         rate(upload_files_rejected_total[1m]) by reason
  Dedup Redis hit rate       dedup_redis_hits / dedup_checks
  Active upload sessions     upload_sessions_active gauge
  Temp disk free             node_filesystem_avail_bytes{mountpoint="/tmp/evsnap"}
  Manager abuse table        files_rejected_total by manager_id over 24h

ROW 3 — Compression
  Queue depth / active / failed / completed
  Compression throughput MB/s in vs out
  Duration p50/p95 by quality preset
  SeaweedFS write rate and errors
  ETag dedup hits
  Postgres indexed_photos insert rate
  Sharp CPU usage (compression worker process)

ROW 4 — Face Indexing
  Queue depth / active / failed / completed   ALERT: failed > 5
  InsightFace inference p50/p95
  Faces per photo histogram
  Photos with no faces rate
  Embeddings written per minute
  pgvector insert latency p95
  InsightFace CPU and memory

ROW 5 — Airflow-style job tracker (Postgres data source)
  Grafana Table panel — query:
    SELECT filename, manager_id,
           MAX(CASE WHEN step='INGESTED'   THEN status END) AS ingested,
           MAX(CASE WHEN step='COMPRESSED' THEN status END) AS compressed,
           MAX(CASE WHEN step='INDEXED'    THEN status END) AS indexed,
           MAX(updated_at) AS last_update
    FROM   job_tracking
    WHERE  session_id = '$session_id'
    GROUP BY filename, manager_id
    ORDER BY last_update DESC
  Cell color overrides: done=green, processing=amber, failed=red, duplicate=blue
  Refresh: 5 seconds
  Variables: $session_id (dropdown from job_tracking.session_id)
             $manager_id (filter)

ROW 6 — Delivery
  Visitors active (gauge)
  Searches per minute
  Search latency p50/p95/p99
  Selfie no-face failures
  Replica lag seconds     ALERT: > 5s
  Results per search histogram
  Top events by search volume

ROW 7 — Database
  Postgres connections (primary vs standby)
  PgBouncer pool utilisation (RW and RO)
  Replication lag seconds (critical alert panel)
  HNSW index size growth
  Query latency p95 (requires pg_stat_statements extension)
  WAL write rate

ROW 8 — Redis
  Per-db key count (db:0 through db:4)
  Memory used / maxmemory ratio
  Commands per second
  AOF rewrite in progress
  Connected clients

ROW 9 — Nginx
  Requests per second
  Active connections
  5xx error rate   ALERT: > 1%
  Upstream response time p95
  Upstream peer health (VM-1 and VM-2 up/down indicators)

ROW 10 — Business Metrics
  Events active today
  Photos uploaded (7d / 30d)
  Unique visitors (7d / 30d)
  Searches (7d / 30d)
  Face index success rate %
  Duplication rate per manager (abuse indicator)
  Storage by event (SeaweedFS per-bucket)
```

### Alerting Rules (add to Prometheus or Grafana alerts)

```
CRITICAL:
  postgres_replication_lag > 10s         page immediately
  up{job=~".*postgres.*"} == 0           page immediately
  bullmq_queue_failed{queue="index"} > 10 page immediately

WARNING:
  postgres_replication_lag > 5s
  bullmq_queue_failed{queue="compress"} > 5
  node_disk_avail < 15%                  (Unraid array)
  node_filesystem_avail{mountpoint="/tmp/evsnap"} < 5GB
  insightface_inference_p95 > 2000ms
  search_latency_p95 > 800ms
  nginx_http_5xx_rate > 0.01
  redis_memory_used / redis_maxmemory > 0.90
```

---

## 14. What Changes vs Current Codebase

### Files removed
```
src/services/compreface.js   → replaced by src/services/insightface.js
src/services/rustfs.js       → replaced by src/services/seaweedfs.js
                               (same function signatures, different endpoint)
```

### Files rewritten
```
src/routes/upload.js         disk storage + hash-during-stream + Redis dedup
                             + 202 response + Socket.io emit + job enqueue
src/routes/search.js         pgvector ANN with replica-aware routing
src/routes/diagnostics.js    new health check targets (InsightFace, Redis queues,
                             SeaweedFS, Postgres replication)
```

### Files added (backend)
```
src/services/insightface.js  sidecar HTTP client (detect, embed, health)
src/services/seaweedfs.js    S3-compatible client for SeaweedFS
src/services/websocket.js    Socket.io server setup + Redis adapter
src/workers/main.js          worker entry point (reads WORKER_TYPE env var)
src/workers/compressionWorker.js  BullMQ consumer, sharp pipeline, quality branch
src/workers/indexingWorker.js     BullMQ consumer, InsightFace call, pgvector insert
src/db/v2_migration.sql      additive schema changes (run once on primary)
face-sidecar/main.py         FastAPI InsightFace service
face-sidecar/Dockerfile      python:3.11-slim, buffalo_l pre-download
face-sidecar/requirements.txt
monitoring/prometheus.yml    scrape configs
monitoring/grafana/          dashboard JSON files
```

### Files added (admin UI)
```
public/admin/index.html      new "Failed Uploads" section with retry button
public/admin/script.js       loadFailedJobs(), retryJob(), queue status panel
```

### Files changed (manager portal)
```
public/manager/index.html    upload progress section with 3-dot status per file
public/manager/script.js     Socket.io client replace polling
                             renderUploadProgress() function
                             3-dot status update on WS events
```

### Files changed (visitor portal)
```
public/visitor/index.html    scan-overlay div + CSS animation
public/visitor/script.js     show/hide overlay on search fetch
                             in-place result rendering (no page reload)
                             confirm selfie JWT stored in sessionStorage
```

### Files unchanged
```
src/middleware/auth.js
src/middleware/validateUuid.js
src/routes/auth.js
src/routes/events.js
src/routes/photos.js
src/routes/favorites.js
src/routes/users.js
src/routes/contact.js
src/routes/feedback.js
src/routes/notifications.js
src/services/mailer.js        (reused for failure alert emails)
public/admin/  (except failed uploads section)
public/client/  (unchanged)
public/landing/ (unchanged)
public/assets/feedback-widget.js
public/assets/feedback-widget.css
```

---

## 15. Migration and Upgrade Paths

### Sandbox → Production (when domain is ready)

```
1. Update ALLOWED_ORIGINS in .env to production domain
2. Update GF_SERVER_ROOT_URL in Grafana env
3. Add Cloudflare tunnel or proxy to Nginx
4. Set Redis requirepass and update REDIS_PASSWORD in all .env files
5. Tighten POSTGRES_REPLICA_LAG_THRESHOLD_MS to 500
6. Set NODE_ENV=production
7. Disable ALERT_EMAIL_*_FAILURE if email volume too high (use Grafana alerts instead)
```

### CPU → GPU (when RTX 3060 installed)

```
Option A: GPU in Unraid box, passthrough to VM-1
  1. Enable VFIO in Unraid (passthrough GPU to VM-1)
  2. Install CUDA drivers inside VM-1
  3. Change in VM-1 .env:
       CTX_ID=-1  →  CTX_ID=0
       UVICORN_WORKERS=2  →  UVICORN_WORKERS=4
       INDEXING_CONCURRENCY=2  →  INDEXING_CONCURRENCY=8
       COMPRESSION_CONCURRENCY=3  →  COMPRESSION_CONCURRENCY=6
  4. Rebuild insightface-sidecar image:
     In face-sidecar/requirements.txt:
       onnxruntime==1.18.0  →  onnxruntime-gpu==1.18.0
     In face-sidecar/Dockerfile:
       FROM python:3.11-slim  →  FROM nvidia/cuda:12.1.0-cudnn8-runtime-ubuntu22.04
  5. Add nvidia-container-toolkit to VM-1
  6. docker compose up --build insightface-sidecar
  Zero application code changes.

Option B: GPU in Proxmox box, passthrough to VM-2
  Same steps as Option A but applied to VM-2.
  VM-2 becomes the indexing powerhouse.
  Consider routing indexing queue workers primarily to VM-2.
```

### VM-2 Unraid → Proxmox migration

```
1. On Proxmox, create Ubuntu 22.04 VM with same resource allocation as current VM-2
2. Install Docker and docker-compose
3. Copy /opt/eventsnapai/ from current VM-2 to Proxmox VM-2:
     rsync -avz /opt/eventsnapai/ proxmox-vm2:/opt/eventsnapai/
4. Do NOT copy /opt/eventsnapai/postgres/data — standby re-syncs from primary
5. On Proxmox VM-2, run pg_basebackup against VM-1 (same command as initial setup)
6. Start all containers: docker compose up -d
7. Verify replication: SELECT pg_is_in_recovery(); → t
8. Update Nginx upstream to new Proxmox VM-2 LAN IP
9. Update Prometheus scrape targets to new IP
10. Decommission old Unraid VM-2
Total downtime: zero (VM-1 handles all traffic during migration)
```

### Scaling beyond two VMs

```
Adding VM-3:
  1. Same docker-compose as VM-2 (copy /opt/eventsnapai/ minus postgres data)
  2. Add VM-3 LAN IP to Nginx upstream block
  3. VM-3 Postgres runs as another standby (pg_basebackup from VM-1)
  4. Add VM-3 scrape targets to Prometheus
  5. BullMQ workers on VM-3 auto-consume from Redis queues — no config change
  6. Socket.io Redis adapter auto-routes WebSocket events — no config change
```

---

## Appendix: SeaweedFS Web UI

```
Master web UI:   http://<UNRAID_LAN_IP>:9333
  Shows: volume servers, storage capacity, cluster topology, free space
  Auth:  none (open — restrict to LAN only via Unraid firewall rules)

Filer web UI:    http://<UNRAID_LAN_IP>:8888
  Shows: file browser, directory structure, stored files
  Auth:  none (open — internal access only)

S3 API:          http://<UNRAID_LAN_IP>:8333
  Auth:  access key / secret key (configured in s3.json)
  Used by: Node app, workers (via AWS SDK pointing at this endpoint)

Production hardening (before domain publish):
  Add -master.admin.ipList=127.0.0.1 to master command
  Access master UI via: ssh -L 9333:localhost:9333 unraid-host
  Filer auth can be added via reverse proxy basic auth in Nginx
```

---

*End of implementation plan.*  
*Next step: Say "build it" specifying Unraid containers first or Ubuntu VM containers first.*
