# DiplomaProject-App

Demo application for a Kubernetes Preview Environment system. This is **one of three repositories** that together form the complete system:

| Repo | Role |
|------|------|
| **DiplomaProject-App** ← you are here | Application source code & CI/CD |
| [DiplomaProject-ArgoCD](https://github.com/MartinovG/DiplomaProject-ArgoCD) | GitOps manifests — what runs in the cluster |
| [DiplomaProject-Terraform](https://github.com/MartinovG/DiplomaProject-Terraform) | AWS infrastructure (EKS, ECR, RDS, VPC, etc.) |

---

## What This Is

An end-to-end demo of automated Kubernetes preview environments with intelligent lifecycle management. When a developer opens a Pull Request, the system automatically:

1. Builds Docker images tagged `backend-pr-{N}` / `frontend-pr-{N}`
2. Pushes them to ECR
3. ArgoCD's ApplicationSet detects the open PR and deploys a dedicated namespace `pr-{N}` with an ephemeral Postgres database
4. A live preview URL is posted to the PR: `https://pr-{N}.elsys.itgix.eu`
5. When the PR is closed, ArgoCD prunes the namespace and everything in it

Merges to `main` follow the same build pipeline but tag images with the git SHA and update the production deployment.

The **PreviewControl** dashboard (this app) sits on top and adds:

- **Auto-sleep** — preview envs that have been idle past their configured timeout are automatically scaled to 0
- **Auto-wake on webhook** — a GitHub webhook scales the env back up when the PR receives a push or comment, before the reviewer opens the link
- **Cost tracking** — accurate per-namespace runtime cost computed from the audit log, plus estimated savings from auto-sleep
- **Per-environment settings** — idle timeout, hourly cost rate, and auto-sleep on/off configurable from the UI

---

## Repository Layout

```
.
├── backend/                  Node.js / Express + Prisma (port 4000)
│   ├── src/
│   │   ├── index.ts          API server + route registration
│   │   ├── k8s.ts            Kubernetes client setup
│   │   ├── autoSleep.ts      Background controller — scales idle envs to 0
│   │   └── cost.ts           Runtime cost computation from AuditLog
│   ├── prisma/schema.prisma  AuditLog + Environment models
│   └── Dockerfile
├── frontend/                 Next.js (port 3000)
│   └── src/app/
│       ├── page.tsx          PreviewControl dashboard UI
│       └── api/health/       Liveness / readiness probe endpoint
└── .github/workflows/
    ├── push-to-ecr.yaml      Build images & push to ECR; update ArgoCD on main
    └── pr-comment.yaml       Post preview URL as a PR comment
```

---

## Architecture

```
Developer opens PR
       │
       ▼
GitHub Actions (push-to-ecr.yaml)
  ├── docker build backend  → ECR tag: backend-pr-{N}
  └── docker build frontend → ECR tag: frontend-pr-{N}
       │
       ▼
ArgoCD ApplicationSet (polls GitHub every 60s)
  └── Detects open PR → creates namespace pr-{N} in EKS
       ├── Deploys backend + frontend from ECR
       ├── Spins up ephemeral Postgres pod
       ├── ExternalSecret pulls DB password from AWS Secrets Manager
       └── ALB Ingress routes pr-{N}.elsys.itgix.eu → services
              ├── /api/* → backend (port 4000)
              └── /      → frontend (port 3000)

PR merged → images tagged sha-{hash} → prod values.yaml updated → ArgoCD syncs prod
PR closed → ArgoCD prunes pr-{N} namespace
```

**Production** runs at `https://gmdiplomaproject.elsys.itgix.eu` with:
- Backend: 2–10 replicas (HPA, 50% CPU target)
- Frontend: 2–5 replicas (HPA, 80% CPU target)
- RDS PostgreSQL 17 (db.t4g.micro) via ACK RDS controller
- Karpenter auto-scales EKS nodes (t3/m/c/r families, spot + on-demand)

---

## Backend API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Liveness/readiness probe |
| `GET` | `/api/envs` | List preview namespaces with status, settings, and cost |
| `POST` | `/api/scale` | Manually sleep or wake a deployment |
| `GET` | `/api/history` | Audit log of sleep/wake actions (last 200 entries) |
| `GET` | `/api/cost` | Cluster-wide cost summary (total spent, total saved, auto-sleep events) |
| `POST` | `/api/settings/:namespace` | Update per-env settings (idle timeout, auto-sleep, hourly rate) |
| `POST` | `/api/webhook/github` | GitHub webhook — wakes the matching `pr-{N}` env |

**POST `/api/scale` body:**
```json
{ "namespace": "pr-5", "deployment": "backend", "action": "wake" }
```
`action` must be `"wake"` or `"sleep"`.

**POST `/api/settings/:namespace` body** (any subset):
```json
{ "idleTimeoutMin": 30, "autoSleepEnabled": true, "hourlyCostUsd": 0.04 }
```

**Audit log actions:**
- `WAKE` / `SLEEP` — manual via dashboard
- `AUTO_SLEEP` — auto-sleep controller scaled an idle env to 0
- `AUTO_WAKE` — GitHub webhook woke a sleeping env

## Auto-Sleep Controller

A background loop inside the backend ticks every 60 seconds. For each managed namespace (`pr-*`):

1. Looks up the `Environment` row (idle timeout, auto-sleep enabled, last activity)
2. Skips if auto-sleep is disabled or if all deployments are already at 0 replicas
3. If `now - lastActivityAt > idleTimeoutMin`, scales every deployment to 0 and records an `AUTO_SLEEP` audit entry with the reason

`lastActivityAt` is bumped on:
- Manual wake from the dashboard
- GitHub webhook (push, comment, reopen)

The controller is gated behind `AUTO_SLEEP_ENABLED=true` so it only runs in the production deployment, not inside individual PR previews.

## Cost Tracking

Cost is computed on demand from the audit log. For each namespace:

- **Cost so far** = (sum of awake intervals × hourly rate). Awake intervals are paired `WAKE` → `SLEEP`/`AUTO_SLEEP` entries; if currently awake, the open interval extends to `now`.
- **Savings** = (sum of asleep intervals after `AUTO_SLEEP` × hourly rate). Represents time the env would have been running if auto-sleep hadn't intervened.

The default hourly rate is `$0.04` (configurable per env via `/api/settings/:namespace`). The cluster runs on a Karpenter NodePool of `t3.medium` instances (mix of spot and on-demand), so this number is a deliberate over-estimate — preview envs share a node and use only a fraction of it.

---

## Environment Variables

### Backend

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Full Postgres connection string (set automatically in cluster) |
| `PORT` | No | HTTP listen port (default `4000`) |
| `AUTO_SLEEP_ENABLED` | No | Set to `true` to run the auto-sleep controller. Should only be `true` in the production deployment. |

In production and preview environments these are injected by the Helm chart from Kubernetes Secrets (managed by External Secrets Operator → AWS Secrets Manager).

For local development, copy `.env` (not committed) and set `DATABASE_URL`.

### Frontend

The frontend calls `/api/*` as relative paths. In Kubernetes an ALB Ingress rule routes those to the backend service. No extra env vars needed.

---

## Local Development

### Prerequisites

- Node.js 22
- Docker (for running Postgres locally)
- A running Kubernetes context if you want the `/api/envs` endpoint to return real data

### Backend

```bash
cd backend
npm install

# Start a local Postgres
docker run -d --name pg -e POSTGRES_USER=admin -e POSTGRES_PASSWORD=password123 \
  -e POSTGRES_DB=preview_db -p 5432:5432 postgres:17-alpine

# Apply the schema
npx prisma db push

# Run in dev mode
npm run dev          # nodemon + ts-node on port 4000
```

### Frontend

```bash
cd frontend
npm install
npm run dev          # Next.js dev server on port 3000
```

The frontend proxies `/api` calls. To point it at the local backend, add a `rewrites` rule to `next.config.ts`:

```ts
async rewrites() {
  return [{ source: '/api/:path*', destination: 'http://localhost:4000/api/:path*' }];
}
```

---

## CI/CD Pipeline

Defined in [`.github/workflows/push-to-ecr.yaml`](.github/workflows/push-to-ecr.yaml).

**On pull request:**
1. Authenticate to AWS via GitHub OIDC (no long-lived keys stored)
2. Build `backend` and `frontend` Docker images
3. Push to ECR with tags `backend-pr-{N}` / `frontend-pr-{N}`
4. GitHub Actions also posts a comment with the preview URL ([`pr-comment.yaml`](.github/workflows/pr-comment.yaml))

**On push to `main`:**
1. Same build & push, tags use the git SHA (`backend-sha-{hash}`)
2. Clone `DiplomaProject-ArgoCD`, `sed`-update `eu-central-1/prod/helm/values.yaml`
3. Commit + push — ArgoCD detects the change and syncs the production deployment

**Required secrets:**
- `ARGOCD_REPO_TOKEN` — GitHub PAT with write access to `DiplomaProject-ArgoCD`

---

## Docker Images

| Image | Registry | Tag (PR) | Tag (main) |
|-------|----------|----------|------------|
| Backend | `787587782604.dkr.ecr.eu-central-1.amazonaws.com/gm-diploma-project-ecr-api` | `backend-pr-{N}` | `backend-sha-{hash}` |
| Frontend | `787587782604.dkr.ecr.eu-central-1.amazonaws.com/gm-diploma-project-ecr-frontend` | `frontend-pr-{N}` | `frontend-sha-{hash}` |

ECR lifecycle policy retains the 10 most recent images per repository.

---

## Health Probes

Both services expose `GET /api/health` returning `{ "status": "ok" }`.
Kubernetes liveness and readiness probes poll this endpoint every 10 seconds; 3 consecutive failures trigger a pod restart.

---

## Database

- **Production**: AWS RDS PostgreSQL 17.6, `db.t4g.micro`, 20 GB gp3. Managed as a Kubernetes CRD via ACK RDS Controller. Schema applied with `prisma db push` at container startup.
- **Preview**: Ephemeral Postgres 17 Alpine pod running in the same namespace as the app. Deleted automatically when the PR closes.

Schema:
- `AuditLog` — every sleep/wake action with namespace, action type (`WAKE` / `SLEEP` / `AUTO_SLEEP` / `AUTO_WAKE`), reason, timestamp.
- `Environment` — per-namespace settings: `lastActivityAt`, `idleTimeoutMin`, `autoSleepEnabled`, `hourlyCostUsd`. Lazily upserted the first time a namespace is observed.

---

## Monitoring

Production observability stack (all in-cluster, deployed via `DiplomaProject-ArgoCD`):

| Tool | Purpose |
|------|---------|
| Prometheus | Metrics collection (kubelet, containers, app) |
| Grafana | Dashboards & alerting — `grafana-gmdiplomaproject.elsys.itgix.eu` |
| Loki + Alloy | Log aggregation from pod stdout |
| Tempo | Distributed tracing (OTLP/Jaeger/Zipkin receivers) |
| Alertmanager | 35 alert rules, fires to Discord |
