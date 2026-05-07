import express, { Request, Response } from 'express';
import cors from 'cors';
import { k8sAppsApi, k8sCoreApi } from './k8s';
import { costSinceCreation, DEFAULT_HOURLY_COST_USD } from './cost';

const app = express();

app.use(cors());
app.use(express.json());

const SYSTEM_NAMESPACES = new Set([
  'kube-system',
  'kube-public',
  'kube-node-lease',
  'argocd',
  'ack-system',
  'external-secrets',
  'monitoring',
  'loki',
  'tempo',
  'alloy',
  'karpenter',
  'default',
]);

const GITHUB_OWNER = process.env.GITHUB_OWNER ?? 'MartinovG';
const GITHUB_REPO = process.env.GITHUB_REPO ?? 'DiplomaProject-App';
const PREVIEW_HOST_SUFFIX = process.env.PREVIEW_HOST_SUFFIX ?? 'elsys.itgix.eu';

function isVisibleNamespace(name: string): boolean {
  if (!name) return false;
  if (SYSTEM_NAMESPACES.has(name)) return false;
  if (name.startsWith('kube-')) return false;
  return true;
}

function parsePrNumber(namespace: string): number | null {
  const m = namespace.match(/^pr-(\d+)$/);
  return m ? Number(m[1]) : null;
}

app.get('/api/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/api', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

// List all visible environments with status, replicas, age, cost, and links.
app.get('/api/envs', async (_req: Request, res: Response) => {
  try {
    const nsRes = await k8sCoreApi.listNamespace();
    const namespaces = (nsRes.items || []).filter((ns) =>
      isVisibleNamespace(ns.metadata?.name || '')
    );

    const data = await Promise.all(
      namespaces.map(async (ns) => {
        const name = ns.metadata?.name || '';
        const created = ns.metadata?.creationTimestamp;

        const deployRes = await k8sAppsApi.listNamespacedDeployment({ namespace: name });
        const deployments = deployRes.items.filter((d) => d.metadata?.name !== 'postgres');

        const totalReplicas = deployments.reduce((s, d) => s + (d.spec?.replicas ?? 0), 0);
        const readyReplicas = deployments.reduce((s, d) => s + (d.status?.readyReplicas ?? 0), 0);

        const prNumber = parsePrNumber(name);
        const isProd = name.includes('prod');

        return {
          name,
          status: totalReplicas > 0 ? 'ACTIVE' : 'SLEEPING',
          replicas: { total: totalReplicas, ready: readyReplicas },
          deployments: deployments.map((d) => d.metadata?.name).filter(Boolean),
          created,
          ageMs: created ? Date.now() - new Date(created).getTime() : null,
          costUsd: costSinceCreation(created instanceof Date ? created : created ? new Date(created) : undefined),
          hourlyCostUsd: DEFAULT_HOURLY_COST_USD,
          prNumber,
          previewUrl: prNumber !== null ? `https://pr-${prNumber}.${PREVIEW_HOST_SUFFIX}` : null,
          githubUrl:
            prNumber !== null
              ? `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/pull/${prNumber}`
              : null,
          isProd,
        };
      })
    );

    data.sort((a, b) => {
      if (a.isProd !== b.isProd) return a.isProd ? -1 : 1;
      return (b.ageMs ?? 0) - (a.ageMs ?? 0);
    });

    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch environments' });
  }
});

// Cluster-wide cost summary.
app.get('/api/cost', async (_req: Request, res: Response) => {
  try {
    const nsRes = await k8sCoreApi.listNamespace();
    const namespaces = (nsRes.items || []).filter((ns) =>
      isVisibleNamespace(ns.metadata?.name || '')
    );

    let totalCostUsd = 0;
    let activeCount = 0;
    let totalCount = 0;

    for (const ns of namespaces) {
      const name = ns.metadata?.name || '';
      totalCostUsd += costSinceCreation(ns.metadata?.creationTimestamp ?? undefined);
      totalCount += 1;

      const deployRes = await k8sAppsApi.listNamespacedDeployment({ namespace: name });
      const active = deployRes.items.some((d) => (d.spec?.replicas ?? 0) > 0);
      if (active) activeCount += 1;
    }

    res.json({
      totalCostUsd,
      hourlyCostUsd: DEFAULT_HOURLY_COST_USD,
      activeCount,
      totalCount,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to compute cost' });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
