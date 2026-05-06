import * as k8s from '@kubernetes/client-node';

const kc = new k8s.KubeConfig();
kc.loadFromDefault();

export const k8sAppsApi = kc.makeApiClient(k8s.AppsV1Api);
export const k8sCoreApi = kc.makeApiClient(k8s.CoreV1Api);
export const k8sObjectApi = k8s.KubernetesObjectApi.makeApiClient(kc);

export async function scaleDeployment(
  name: string,
  namespace: string,
  replicas: number
): Promise<void> {
  await k8sObjectApi.patch(
    {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name, namespace },
      spec: { replicas },
    },
    undefined,
    undefined,
    undefined,
    undefined,
    k8s.PatchStrategy.MergePatch
  );
}
