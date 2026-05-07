// Default hourly USD rate per preview environment.
// Karpenter runs t3.medium (~$0.04/hr on-demand). A preview env uses a small
// fraction of a node, so this is a deliberate over-estimate.
export const DEFAULT_HOURLY_COST_USD = Number(process.env.HOURLY_COST_USD ?? 0.04);

export function costSinceCreation(createdAt: Date | string | undefined): number {
  if (!createdAt) return 0;
  const created = typeof createdAt === 'string' ? new Date(createdAt) : createdAt;
  const hours = (Date.now() - created.getTime()) / 3_600_000;
  return Math.max(hours, 0) * DEFAULT_HOURLY_COST_USD;
}
