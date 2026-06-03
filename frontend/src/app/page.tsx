"use client";
import { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import {
  Clock, Server, RefreshCw, Zap, Box, AlertCircle, X,
  DollarSign, ExternalLink, GitPullRequest, Activity, Sparkles,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

const API_URL = '/api';

interface Env {
  name: string;
  status: 'ACTIVE' | 'SLEEPING';
  replicas: { total: number; ready: number };
  deployments: string[];
  created: string | undefined;
  ageMs: number | null;
  costUsd: number;
  hourlyCostUsd: number;
  prNumber: number | null;
  previewUrl: string | null;
  githubUrl: string | null;
  isProd: boolean;
}

interface ClusterCost {
  totalCostUsd: number;
  hourlyCostUsd: number;
  activeCount: number;
  totalCount: number;
}

const formatUsd = (n: number) => `$${n.toFixed(4)}`;
const formatUsdShort = (n: number) => `$${n.toFixed(2)}`;

export default function Dashboard() {
  const [envs, setEnvs] = useState<Env[]>([]);
  const [cost, setCost] = useState<ClusterCost | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshData = useCallback(async () => {
    try {
      const [envRes, costRes] = await Promise.all([
        axios.get<Env[]>(`${API_URL}/envs`),
        axios.get<ClusterCost>(`${API_URL}/cost`),
      ]);
      setEnvs(envRes.data);
      setCost(costRes.data);
      setError(null);
    } catch {
      setError('Unable to reach backend. Is the API running?');
    }
  }, []);

  useEffect(() => {
    refreshData();
    const interval = setInterval(refreshData, 30_000);
    return () => clearInterval(interval);
  }, [refreshData]);

  const getStatusColor = (status: string) =>
    status === 'ACTIVE'
      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.2)]'
      : 'bg-amber-500/10 text-amber-400 border-amber-500/20';

  return (
    <main className="min-h-screen bg-[#0a0c10] text-slate-300 font-sans selection:bg-violet-500/30">
      <div className="sticky top-0 z-50 bg-gradient-to-r from-violet-600 via-purple-500 to-indigo-500 text-white text-sm font-bold tracking-wide py-2.5 px-4 flex items-center justify-center gap-2 shadow-lg shadow-violet-500/30">
        <Sparkles className="w-4 h-4" />
        PREVIEW BUILD — test2 branch
        <Sparkles className="w-4 h-4" />
      </div>

      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-violet-900/15 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-900/15 rounded-full blur-[120px]" />
      </div>

      <div className="relative max-w-7xl mx-auto p-8 grid grid-cols-1 lg:grid-cols-12 gap-6">
        <header className="lg:col-span-12 flex justify-between items-center mb-2 border-b border-white/5 pb-6">
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-violet-500 to-indigo-600 rounded-lg shadow-lg shadow-violet-500/30">
                <Zap className="w-6 h-6 text-white" />
              </div>
              Preview<span className="text-violet-400">Control</span>
            </h1>
            <p className="text-slate-500 text-sm mt-2 ml-1">
              Read-only Kubernetes preview environment dashboard
            </p>
          </div>
          <button
            onClick={refreshData}
            className="group flex items-center gap-2 text-xs font-medium bg-white/5 border border-white/10 px-4 py-2 rounded-full hover:bg-white/10 transition-all hover:border-white/20 active:scale-95"
          >
            <RefreshCw className="w-3.5 h-3.5 group-hover:rotate-180 transition-transform duration-500" />
            Sync Cluster
          </button>
        </header>

        {/* Cluster Summary */}
        <section className="lg:col-span-12 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <SummaryCard
            icon={<DollarSign className="w-4 h-4 text-cyan-400" />}
            label="Total spent"
            value={cost ? formatUsdShort(cost.totalCostUsd) : '—'}
            sub={cost ? `at $${cost.hourlyCostUsd.toFixed(3)}/hr per env` : ''}
          />
          <SummaryCard
            icon={<Activity className="w-4 h-4 text-emerald-400" />}
            label="Active environments"
            value={cost ? `${cost.activeCount}` : '—'}
            sub={cost ? `of ${cost.totalCount} total` : ''}
            tone="emerald"
          />
          <SummaryCard
            icon={<Server className="w-4 h-4 text-purple-400" />}
            label="Tracked namespaces"
            value={cost ? String(cost.totalCount) : '—'}
            sub="prod + open PRs"
            tone="purple"
          />
        </section>

        {error && (
          <div className="lg:col-span-12 flex items-center gap-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm px-4 py-3 rounded-lg">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="hover:text-red-300 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Environments */}
        <div className="lg:col-span-12 space-y-4">
          <div className="flex items-center justify-between px-1 mb-2">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <Server className="w-4 h-4" /> Environments
            </h2>
            <span className="text-xs text-slate-600 bg-white/5 px-2 py-1 rounded">
              {envs.length} Total
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {envs.map((env) => (
              <div
                key={env.name}
                className="group relative bg-[#12141a] border border-white/5 rounded-xl p-5 hover:border-cyan-500/30 transition-all duration-300 hover:shadow-lg hover:shadow-cyan-900/10 overflow-hidden"
              >
                <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-cyan-500 to-blue-600 opacity-0 group-hover:opacity-100 transition-opacity" />

                <div className="flex justify-between items-start gap-3">
                  <div className="flex items-start gap-4 min-w-0">
                    <div className="p-3 rounded-lg bg-slate-800/50 border border-white/5 shrink-0">
                      <Box className="w-6 h-6 text-slate-400 group-hover:text-cyan-400 transition-colors" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-lg font-bold text-white flex items-center gap-2 flex-wrap">
                        <span className="truncate">{env.name}</span>
                        {env.isProd && (
                          <span className="text-[10px] bg-blue-500/20 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded font-mono">
                            PROD
                          </span>
                        )}
                        {env.prNumber !== null && (
                          <span className="text-[10px] bg-purple-500/20 text-purple-400 border border-purple-500/30 px-2 py-0.5 rounded font-mono">
                            PR #{env.prNumber}
                          </span>
                        )}
                      </h3>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <p className="text-xs text-slate-500 flex items-center gap-1.5 bg-white/5 px-2 py-0.5 rounded">
                          <Clock className="w-3 h-3" />
                          {env.created ? formatDistanceToNow(new Date(env.created)) : 'Unknown'} old
                        </p>
                        <p className="text-xs text-slate-600 font-mono">
                          {env.replicas.ready}/{env.replicas.total} pods
                        </p>
                        <p className="text-xs text-cyan-400/80 flex items-center gap-1">
                          <DollarSign className="w-3 h-3" /> {formatUsd(env.costUsd)}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold border shrink-0 ${getStatusColor(env.status)}`}
                  >
                    <span className="relative flex h-2 w-2">
                      <span
                        className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${env.status === 'ACTIVE' ? 'bg-emerald-400' : 'bg-amber-400'}`}
                      />
                      <span
                        className={`relative inline-flex rounded-full h-2 w-2 ${env.status === 'ACTIVE' ? 'bg-emerald-500' : 'bg-amber-500'}`}
                      />
                    </span>
                    {env.status}
                  </div>
                </div>

                {(env.previewUrl || env.githubUrl) && (
                  <div className="mt-4 pt-4 border-t border-white/5 flex items-center gap-2 flex-wrap">
                    {env.previewUrl && (
                      <a
                        href={env.previewUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 text-xs font-medium bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 px-3 py-1.5 rounded-lg hover:bg-cyan-500/20 transition-all active:scale-95"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Open preview
                      </a>
                    )}
                    {env.githubUrl && (
                      <a
                        href={env.githubUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 text-xs font-medium bg-white/5 border border-white/10 text-slate-300 px-3 py-1.5 rounded-lg hover:bg-white/10 transition-all active:scale-95"
                      >
                        <GitPullRequest className="w-3.5 h-3.5" />
                        View PR on GitHub
                      </a>
                    )}
                  </div>
                )}
              </div>
            ))}

            {envs.length === 0 && (
              <div className="md:col-span-2 flex flex-col items-center justify-center py-20 border-2 border-dashed border-white/5 rounded-xl bg-white/[0.02]">
                <div className="p-4 bg-slate-800/50 rounded-full mb-4">
                  <Server className="w-8 h-8 text-slate-600" />
                </div>
                <p className="text-slate-500 font-medium">No environments found.</p>
                <p className="text-xs text-slate-600 mt-1">
                  Open a Pull Request to trigger a new preview.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  sub,
  tone = 'cyan',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tone?: 'cyan' | 'emerald' | 'purple';
}) {
  const tint = {
    cyan: 'from-cyan-500/10 to-blue-600/5 border-cyan-500/10',
    emerald: 'from-emerald-500/10 to-teal-600/5 border-emerald-500/10',
    purple: 'from-purple-500/10 to-fuchsia-600/5 border-purple-500/10',
  }[tone];

  return (
    <div className={`relative bg-gradient-to-br ${tint} border rounded-xl p-5 backdrop-blur-sm`}>
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-slate-400 font-semibold">
        {icon}
        {label}
      </div>
      <div className="text-3xl font-bold text-white mt-3 tracking-tight">{value}</div>
      <div className="text-xs text-slate-500 mt-1">{sub}</div>
    </div>
  );
}
