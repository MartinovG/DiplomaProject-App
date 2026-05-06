import { PrismaClient } from '@prisma/client';

export interface NamespaceCost {
  namespace: string;
  awakeSeconds: number;
  asleepAfterAutoSleepSeconds: number;
  costUsd: number;
  savingsUsd: number;
  hourlyCostUsd: number;
}

export interface ClusterCost {
  totalCostUsd: number;
  totalSavingsUsd: number;
  autoSleepEvents: number;
  perNamespace: NamespaceCost[];
}

const WAKE_ACTIONS = new Set(['WAKE', 'AUTO_WAKE']);
const SLEEP_ACTIONS = new Set(['SLEEP', 'AUTO_SLEEP']);

export async function computeClusterCost(prisma: PrismaClient): Promise<ClusterCost> {
  const logs = await prisma.auditLog.findMany({ orderBy: { timestamp: 'asc' } });
  const envs = await prisma.environment.findMany();
  const rateByNs = new Map(envs.map((e) => [e.namespace, e.hourlyCostUsd]));

  const byNs = new Map<string, typeof logs>();
  for (const log of logs) {
    if (!byNs.has(log.namespace)) byNs.set(log.namespace, []);
    byNs.get(log.namespace)!.push(log);
  }

  const now = Date.now();
  const perNamespace: NamespaceCost[] = [];
  let autoSleepEvents = 0;

  for (const [namespace, nsLogs] of byNs) {
    let awakeSeconds = 0;
    let asleepAfterAutoSleepSeconds = 0;
    let wakeAt: number | null = null;
    let autoSleepAt: number | null = null;

    for (const log of nsLogs) {
      const ts = log.timestamp.getTime();
      if (WAKE_ACTIONS.has(log.action)) {
        if (wakeAt === null) wakeAt = ts;
        if (autoSleepAt !== null) {
          asleepAfterAutoSleepSeconds += (ts - autoSleepAt) / 1000;
          autoSleepAt = null;
        }
      } else if (SLEEP_ACTIONS.has(log.action)) {
        if (wakeAt !== null) {
          awakeSeconds += (ts - wakeAt) / 1000;
          wakeAt = null;
        }
        if (log.action === 'AUTO_SLEEP') {
          autoSleepAt = ts;
          autoSleepEvents += 1;
        }
      }
    }

    if (wakeAt !== null) awakeSeconds += (now - wakeAt) / 1000;
    if (autoSleepAt !== null) asleepAfterAutoSleepSeconds += (now - autoSleepAt) / 1000;

    const hourlyCostUsd = rateByNs.get(namespace) ?? 0.04;
    const costUsd = (awakeSeconds / 3600) * hourlyCostUsd;
    const savingsUsd = (asleepAfterAutoSleepSeconds / 3600) * hourlyCostUsd;

    perNamespace.push({
      namespace,
      awakeSeconds,
      asleepAfterAutoSleepSeconds,
      costUsd,
      savingsUsd,
      hourlyCostUsd,
    });
  }

  const totalCostUsd = perNamespace.reduce((s, n) => s + n.costUsd, 0);
  const totalSavingsUsd = perNamespace.reduce((s, n) => s + n.savingsUsd, 0);

  return { totalCostUsd, totalSavingsUsd, autoSleepEvents, perNamespace };
}
