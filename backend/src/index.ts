import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import { k8sAppsApi, k8sCoreApi, scaleDeployment } from './k8s';
import { computeClusterCost } from './cost';
import { startAutoSleepController, touchActivity } from './autoSleep';

const app = express();
const prisma = new PrismaClient();

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

function isVisibleNamespace(name: string): boolean {
  if (!name) return false;
  if (SYSTEM_NAMESPACES.has(name)) return false;
  if (name.startsWith('kube-')) return false;
  return true;
}

// Only pr-* preview namespaces can be scaled or auto-slept from the dashboard.
// Production and other long-lived namespaces are protected.
function isScalable(name: string): boolean {
  return name.startsWith('pr-');
}

app.get('/api/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/api', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

// List preview environments with status, settings, and cost.
app.get('/api/envs', async (_req: Request, res: Response) => {
  try {
    const nsRes = await k8sCoreApi.listNamespace();
    const namespaces = (nsRes.items || []).filter((ns) =>
      isVisibleNamespace(ns.metadata?.name || '')
    );

    const cost = await computeClusterCost(prisma);
    const costByNs = new Map(cost.perNamespace.map((c) => [c.namespace, c]));

    const data = await Promise.all(
      namespaces.map(async (ns) => {
        const name = ns.metadata?.name || '';
        const deployRes = await k8sAppsApi.listNamespacedDeployment({ namespace: name });
        const deployments = deployRes.items;
        const primary = deployments.find((d) => d.metadata?.name !== 'postgres') ?? deployments[0];
        const replicas = primary?.spec?.replicas ?? 0;

        const env = await prisma.environment.upsert({
          where: { namespace: name },
          update: {},
          create: { namespace: name },
        });

        const idleMs = Date.now() - env.lastActivityAt.getTime();
        const idleTimeoutMs = env.idleTimeoutMin * 60_000;
        const sleepInMs = env.autoSleepEnabled && replicas > 0
          ? Math.max(idleTimeoutMs - idleMs, 0)
          : null;

        const c = costByNs.get(name);

        return {
          name,
          deployment: primary?.metadata?.name,
          status: replicas > 0 ? 'ACTIVE' : 'SLEEPING',
          created: ns.metadata?.creationTimestamp,
          lastActivityAt: env.lastActivityAt,
          idleTimeoutMin: env.idleTimeoutMin,
          autoSleepEnabled: env.autoSleepEnabled,
          hourlyCostUsd: env.hourlyCostUsd,
          sleepInMs,
          costUsd: c?.costUsd ?? 0,
          savingsUsd: c?.savingsUsd ?? 0,
          protected: !isScalable(name),
        };
      })
    );

    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch environments' });
  }
});

// Sleep or wake an environment.
app.post('/api/scale', async (req: Request, res: Response) => {
  const { namespace, deployment, action } = req.body ?? {};

  if (!namespace || !deployment || !['wake', 'sleep'].includes(action)) {
    res.status(400).json({ error: 'namespace, deployment, and action (wake|sleep) are required' });
    return;
  }

  if (!isScalable(namespace)) {
    res.status(403).json({
      error: `namespace "${namespace}" is protected; only pr-* preview envs can be scaled from the dashboard`,
    });
    return;
  }

  const replicas = action === 'wake' ? 1 : 0;

  try {
    await scaleDeployment(deployment, namespace, replicas);

    await prisma.auditLog.create({
      data: { namespace, action: action.toUpperCase(), reason: 'manual' },
    });

    if (action === 'wake') await touchActivity(prisma, namespace);

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to scale environment' });
  }
});

// Audit history.
app.get('/api/history', async (_req: Request, res: Response) => {
  try {
    const logs = await prisma.auditLog.findMany({
      orderBy: { timestamp: 'desc' },
      take: 200,
    });
    res.json(logs);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch audit history' });
  }
});

// Cluster-wide cost summary.
app.get('/api/cost', async (_req: Request, res: Response) => {
  try {
    const cost = await computeClusterCost(prisma);
    res.json(cost);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to compute cost' });
  }
});

// Update per-environment settings (idle timeout, auto-sleep enable, hourly rate).
app.post('/api/settings/:namespace', async (req: Request, res: Response) => {
  const { namespace } = req.params;
  const { idleTimeoutMin, autoSleepEnabled, hourlyCostUsd } = req.body ?? {};

  const data: { idleTimeoutMin?: number; autoSleepEnabled?: boolean; hourlyCostUsd?: number } = {};
  if (typeof idleTimeoutMin === 'number' && idleTimeoutMin > 0) data.idleTimeoutMin = idleTimeoutMin;
  if (typeof autoSleepEnabled === 'boolean') data.autoSleepEnabled = autoSleepEnabled;
  if (typeof hourlyCostUsd === 'number' && hourlyCostUsd >= 0) data.hourlyCostUsd = hourlyCostUsd;

  if (Object.keys(data).length === 0) {
    res.status(400).json({ error: 'no valid fields to update' });
    return;
  }

  try {
    const env = await prisma.environment.upsert({
      where: { namespace },
      update: data,
      create: { namespace, ...data },
    });
    res.json(env);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// GitHub webhook: wake an environment when a PR receives a push or comment.
app.post('/api/webhook/github', async (req: Request, res: Response) => {
  const event = req.headers['x-github-event'];
  const payload = req.body ?? {};
  const prNumber = payload.pull_request?.number ?? payload.issue?.number;

  if (!prNumber) {
    res.status(400).json({ error: 'no PR number in payload' });
    return;
  }

  const namespace = `pr-${prNumber}`;

  try {
    const deployRes = await k8sAppsApi.listNamespacedDeployment({ namespace });
    const deployments = deployRes.items.filter((d) => d.metadata?.name !== 'postgres');
    let woke = 0;

    for (const d of deployments) {
      const name = d.metadata?.name;
      if (!name) continue;
      const replicas = d.spec?.replicas ?? 0;
      if (replicas === 0) {
        await scaleDeployment(name, namespace, 1);
        woke += 1;
      }
    }

    if (woke > 0) {
      await prisma.auditLog.create({
        data: { namespace, action: 'AUTO_WAKE', reason: `github:${event ?? 'unknown'}` },
      });
    }

    await touchActivity(prisma, namespace);
    res.json({ success: true, woke });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to process webhook' });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
  startAutoSleepController(prisma);
});
