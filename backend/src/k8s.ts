import * as k8s from '@kubernetes/client-node';

const kc = new k8s.KubeConfig();
// This line is magic: It works on your laptop (loading ~/.kube/config)
// AND inside the cluster (loading ServiceAccount token) automatically.
kc.loadFromDefault();

export const k8sAppsApi = kc.makeApiClient(k8s.AppsV1Api);
export const k8sCoreApi = kc.makeApiClient(k8s.CoreV1Api);