import express, { Request, Response } from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import { k8sAppsApi, k8sCoreApi } from './k8s';

const app = express();
const prisma = new PrismaClient();

app.use(cors()); // Allow Frontend (port 3000) to talk to us (port 4000)
app.use(express.json());

// 1. GET: List all Preview Environments
app.get('/api/envs', async (req: Request, res: Response) => {
  try {
    const nsRes = await k8sCoreApi.listNamespace();
    const envs = nsRes.body.items;
    // // Filter for namespaces starting with "pr-" (your previews) or "student-"
    // const envs = nsRes.body.items.filter(ns => 
    //   ns.metadata?.name?.startsWith('pr-') || ns.metadata?.name?.startsWith('student')
    // );

    const data = await Promise.all(envs.map(async (ns) => {
      const name = ns.metadata?.name || '';
      // Check deployment status to see if it's sleeping
      const deployRes = await k8sAppsApi.listNamespacedDeployment(name);
      const deployment = deployRes.body.items[0]; 
      const replicas = deployment?.spec?.replicas ?? 0;

      return {
        name,
        deployment: deployment?.metadata?.name,
        status: replicas > 0 ? 'ACTIVE' : 'SLEEPING',
        created: ns.metadata?.creationTimestamp
      };
    }));

    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch environments' });
  }
});

// 2. POST: Sleep or Wake an Environment
app.post('/api/scale', async (req: Request, res: Response) => {
  const { namespace, deployment, action } = req.body;
  const replicas = action === 'wake' ? 1 : 0;

  try {
    // A. Scale Kubernetes
    // A. Scale Kubernetes
    await k8sAppsApi.patchNamespacedDeploymentScale(
      deployment,
      namespace,
      { spec: { replicas } },
      undefined, // pretty
      undefined, // dryRun
      undefined, // fieldManager
      undefined, // fieldValidation (This is likely the missing one in v0.21+)
      undefined, // force
      { headers: { 'Content-Type': 'application/merge-patch+json' } }
    );

    // B. Save to Database
    await prisma.auditLog.create({
      data: { namespace, action: action.toUpperCase() }
    });

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to scale environment' });
  }
});

// 3. GET: Fetch Audit History
app.get('/api/history', async (req, res) => {
  const logs = await prisma.auditLog.findMany({ orderBy: { timestamp: 'desc' } });
  res.json(logs);
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`🚀 Backend running on port ${PORT}`));