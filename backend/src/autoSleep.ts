import { PrismaClient } from '@prisma/client';
import { k8sAppsApi, k8sCoreApi, scaleDeployment } from './k8s';

const TICK_MS = 60_000;
const MANAGED_NAMESPACE_PREFIXES = ['pr-'];

function isManaged(namespace: string): boolean {
  return MANAGED_NAMESPACE_PREFIXES.some((p) => namespace.startsWith(p));
}

async function tick(prisma: PrismaClient): Promise<void> {
  const nsRes = await k8sCoreApi.listNamespace();
  const namespaces = (nsRes.items || [])
    .map((ns) => ns.metadata?.name || '')
    .filter((n) => n && isManaged(n));

  for (const namespace of namespaces) {
    const env = await prisma.environment.upsert({
      where: { namespace },
      update: {},
      create: { namespace },
    });

    if (!env.autoSleepEnabled) continue;

    const deployRes = await k8sAppsApi.listNamespacedDeployment({ namespace });
    const active = deployRes.items.filter((d) => (d.spec?.replicas ?? 0) > 0);
    if (active.length === 0) continue;

    const idleMs = Date.now() - env.lastActivityAt.getTime();
    if (idleMs < env.idleTimeoutMin * 60_000) continue;

    for (const deployment of active) {
      const name = deployment.metadata?.name;
      if (!name) continue;
      try {
        await scaleDeployment(name, namespace, 0);
      } catch (err) {
        console.error(`auto-sleep: failed to scale ${namespace}/${name}`, err);
      }
    }

    await prisma.auditLog.create({
      data: {
        namespace,
        action: 'AUTO_SLEEP',
        reason: `idle for ${Math.round(idleMs / 60_000)} min`,
      },
    });

    console.log(`auto-sleep: ${namespace} (idle ${Math.round(idleMs / 60_000)} min)`);
  }
}

export function startAutoSleepController(prisma: PrismaClient): void {
  if (process.env.AUTO_SLEEP_ENABLED !== 'true') {
    console.log('auto-sleep controller disabled (set AUTO_SLEEP_ENABLED=true to enable)');
    return;
  }

  console.log(`auto-sleep controller started (tick every ${TICK_MS / 1000}s)`);

  const run = async () => {
    try {
      await tick(prisma);
    } catch (err) {
      console.error('auto-sleep tick failed', err);
    }
  };

  setTimeout(run, 10_000);
  setInterval(run, TICK_MS);
}

export async function touchActivity(prisma: PrismaClient, namespace: string): Promise<void> {
  await prisma.environment.upsert({
    where: { namespace },
    update: { lastActivityAt: new Date() },
    create: { namespace, lastActivityAt: new Date() },
  });
}
