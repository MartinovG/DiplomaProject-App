# DiplomaProject-App

Demo application for a Kubernetes Preview Environment system. This is **one of three repositories** that together form the complete system:

| Repo | Role |
|------|------|
| **DiplomaProject-App** ← you are here | Application source code & CI/CD |
| [DiplomaProject-ArgoCD](https://github.com/MartinovG/DiplomaProject-ArgoCD) | GitOps manifests — what runs in the cluster |
| [DiplomaProject-Terraform](https://github.com/MartinovG/DiplomaProject-Terraform) | AWS infrastructure (EKS, ECR, RDS, VPC, etc.) |

---

## What This Is

An end-to-end demo of automated Kubernetes preview environments. When a developer opens a Pull Request, the system automatically:

1. Builds Docker images tagged `backend-pr-{N}` / `frontend-pr-{N}`
2. Pushes them to ECR
3. ArgoCD's ApplicationSet detects the open PR and deploys a dedicated namespace `pr-{N}` with an ephemeral Postgres database
4. A live preview URL is posted to the PR: `https://pr-{N}.elsys.itgix.eu`
5. When the PR is closed, ArgoCD prunes the namespace and everything in it

Merges to `main` follow the same build pipeline but tag images with the git SHA and update the production deployment.

The **PreviewControl** dashboard (this app) is a read-only operator view on top:

- Lists every preview namespace plus prod, with live status (active vs. sleeping based on replica count)
- Shows pod readiness, namespace age, and accumulated runtime cost per environment
- Direct links: **Open preview** → live URL, **View PR on GitHub** → the originating Pull Request
- A separate hourly CronJob in [DiplomaProject-ArgoCD](https://github.com/MartinovG/DiplomaProject-ArgoCD) garbage-collects `pr-*` namespaces whose PRs have closed

---

## Repository Layout

```
.
├── backend/                  Node.js / Express (port 4000)
│   ├── src/
│   │   ├── index.ts          API server + route registration
│   │   ├── k8s.ts            Kubernetes client setup
│   │   └── cost.ts           Runtime cost calculation
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
PR closed → ArgoCD prunes pr-{N} (namespace garbage-collected hourly by cleanup CronJob)
```

**Production** runs at `https://gmdiplomaproject.elsys.itgix.eu` with:
- Backend: 2–10 replicas (HPA, 50% CPU target)
- Frontend: 2–5 replicas (HPA, 80% CPU target)
- RDS PostgreSQL 17 (db.t4g.micro) via ACK RDS controller
- Karpenter auto-scales EKS nodes (t3/m/c/r families, spot + on-demand)

---

## Backend API

All endpoints are read-only.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Liveness/readiness probe |
| `GET` | `/api/envs` | List all visible namespaces with status, replica counts, age, cost, preview URL, and GitHub PR URL |
| `GET` | `/api/cost` | Cluster-wide cost summary (total spent, active count, total count) |

System namespaces (`kube-*`, `argocd`, `monitoring`, `loki`, etc.) are filtered out of the list. The dashboard intentionally has no scaling, settings, or webhook endpoints — it cannot stop, start, or otherwise affect any deployment.

## Cost Tracking

For each visible namespace, cost is computed as:

```
costUsd = (now - namespace.creationTimestamp) × HOURLY_COST_USD
```

The default rate is `$0.04/hr` per environment, configurable via the `HOURLY_COST_USD` env var. The cluster runs on a Karpenter NodePool of `t3.medium` instances (mix of spot and on-demand), so this number is a deliberate over-estimate — preview envs share a node and use only a fraction of it. The cluster summary at `/api/cost` sums these per-namespace values.

---

## Environment Variables

### Backend

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | HTTP listen port (default `4000`) |
| `HOURLY_COST_USD` | No | Per-environment hourly cost rate used for cost calculations (default `0.04`) |
| `GITHUB_OWNER` | No | GitHub repo owner used to build PR URLs (default `MartinovG`) |
| `GITHUB_REPO` | No | GitHub repo name used to build PR URLs (default `DiplomaProject-App`) |
| `PREVIEW_HOST_SUFFIX` | No | DNS suffix used to build preview URLs (default `elsys.itgix.eu`) |

The backend has no database connection — it's a thin layer over the Kubernetes API.

### Frontend

The frontend calls `/api/*` as relative paths. In Kubernetes an ALB Ingress rule routes those to the backend service. No extra env vars needed.

---

## Local Development

### Prerequisites

- Node.js 22
- A running Kubernetes context if you want `/api/envs` to return real data (the backend reads from `~/.kube/config` automatically)

### Backend

```bash
cd backend
npm install
npm run dev          # nodemon + ts-node on port 4000
```

### Frontend

```bash
cd frontend
npm install
npm run dev          # Next.js dev server on port 3000
```

The frontend calls `/api/*` as relative paths. To proxy them to the local backend in dev, add a `rewrites` rule to `next.config.ts`:

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

## Monitoring

Production observability stack (all in-cluster, deployed via `DiplomaProject-ArgoCD`):

| Tool | Purpose |
|------|---------|
| Prometheus | Metrics collection (kubelet, containers, app) |
| Grafana | Dashboards & alerting — `grafana-gmdiplomaproject.elsys.itgix.eu` |
| Loki + Alloy | Log aggregation from pod stdout |
| Tempo | Distributed tracing (OTLP/Jaeger/Zipkin receivers) |
| Alertmanager | 35 alert rules, fires to Discord |
