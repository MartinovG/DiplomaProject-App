"use client";
import { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import {
  Play, Pause, Clock, Server, RefreshCw, Terminal, Layers, Box,
  AlertCircle, X, DollarSign, PiggyBank, Moon, Settings as SettingsIcon
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

const API_URL = '/api';

interface Env {
  name: string;
  deployment: string | undefined;
  status: 'ACTIVE' | 'SLEEPING';
  created: string | undefined;
  lastActivityAt: string;
  idleTimeoutMin: number;
  autoSleepEnabled: boolean;
  hourlyCostUsd: number;
  sleepInMs: number | null;
  costUsd: number;
  savingsUsd: number;
}

interface Log {
  id: number;
  namespace: string;
  action: string;
  reason: string | null;
  timestamp: string;
}

interface ClusterCost {
  totalCostUsd: number;
  totalSavingsUsd: number;
  autoSleepEvents: number;
}

const formatUsd = (n: number) => `$${n.toFixed(4)}`;
const formatUsdShort = (n: number) => `$${n.toFixed(2)}`;

function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

function actionColor(action: string): string {
  if (action === 'AUTO_SLEEP') return 'text-purple-400';
  if (action === 'AUTO_WAKE') return 'text-cyan-400';
  if (action === 'SLEEP') return 'text-amber-500';
  return 'text-emerald-500';
}

export default function Dashboard() {
  const [envs, setEnvs] = useState<Env[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [cost, setCost] = useState<ClusterCost | null>(null);
  const [loadingEnvs, setLoadingEnvs] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  const refreshData = useCallback(async () => {
    try {
      const [envRes, logRes, costRes] = await Promise.all([
        axios.get<Env[]>(`${API_URL}/envs`),
        axios.get<Log[]>(`${API_URL}/history`),
        axios.get<ClusterCost>(`${API_URL}/cost`),
      ]);
      setEnvs(envRes.data);
      setLogs(logRes.data);
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

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const toggleEnv = async (env: Env) => {
    setLoadingEnvs((prev) => new Set(prev).add(env.name));
    const action = env.status === 'ACTIVE' ? 'sleep' : 'wake';
    try {
      await axios.post(`${API_URL}/scale`, {
        namespace: env.name,
        deployment: env.deployment,
        action,
      });
      setTimeout(refreshData, 800);
    } catch {
      setError(`Failed to ${action} "${env.name}". Check backend logs.`);
    } finally {
      setLoadingEnvs((prev) => {
        const next = new Set(prev);
        next.delete(env.name);
        return next;
      });
    }
  };

  const updateSettings = async (
    namespace: string,
    patch: Partial<Pick<Env, 'idleTimeoutMin' | 'autoSleepEnabled' | 'hourlyCostUsd'>>
  ) => {
    try {
      await axios.post(`${API_URL}/settings/${namespace}`, patch);
      refreshData();
    } catch {
      setError(`Failed to update settings for "${namespace}".`);
    }
  };

  const getStatusColor = (status: string) =>
    status === 'ACTIVE'
      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.2)]'
      : 'bg-amber-500/10 text-amber-400 border-amber-500/20';

  return (
    <main className="min-h-screen bg-[#0a0c10] text-slate-300 font-sans selection:bg-cyan-500/30">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-900/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-cyan-900/10 rounded-full blur-[120px]" />
      </div>

      <div className="relative max-w-7xl mx-auto p-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        <header className="lg:col-span-12 flex justify-between items-center mb-2 border-b border-white/5 pb-6">
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-lg shadow-lg shadow-cyan-500/20">
                <Layers className="w-6 h-6 text-white" />
              </div>
              Preview<span className="text-slate-500">Control</span>
            </h1>
            <p className="text-slate-500 text-sm mt-2 ml-1">
              Kubernetes Environment Lifecycle Manager
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

        {/* Cost Summary */}
        <section className="lg:col-span-12 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <SummaryCard
            icon={<DollarSign className="w-4 h-4 text-cyan-400" />}
            label="Total spent"
            value={cost ? formatUsdShort(cost.totalCostUsd) : '—'}
            sub="across all preview envs"
          />
          <SummaryCard
            icon={<PiggyBank className="w-4 h-4 text-emerald-400" />}
            label="Saved by auto-sleep"
            value={cost ? formatUsdShort(cost.totalSavingsUsd) : '—'}
            sub="vs. running 24/7"
            tone="emerald"
          />
          <SummaryCard
            icon={<Moon className="w-4 h-4 text-purple-400" />}
            label="Auto-sleep events"
            value={cost ? String(cost.autoSleepEvents) : '—'}
            sub="lifetime"
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
        <div className="lg:col-span-8 space-y-4">
          <div className="flex items-center justify-between px-1 mb-2">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <Server className="w-4 h-4" /> Active Namespaces
            </h2>
            <span className="text-xs text-slate-600 bg-white/5 px-2 py-1 rounded">
              {envs.length} Total
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {envs.map((env) => {
              const isLoading = loadingEnvs.has(env.name);
              const remainingMs =
                env.idleTimeoutMin * 60_000 - (now - Date.parse(env.lastActivityAt));
              const showCountdown =
                env.status === 'ACTIVE' && env.autoSleepEnabled && remainingMs > 0;
              const isPr = env.name.startsWith('pr-');
              const isProd = env.name.includes('prod');

              return (
                <div
                  key={env.name}
                  className="group relative bg-[#12141a] border border-white/5 rounded-xl p-5 hover:border-cyan-500/30 transition-all duration-300 hover:shadow-lg hover:shadow-cyan-900/10 overflow-hidden"
                >
                  <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-cyan-500 to-blue-600 opacity-0 group-hover:opacity-100 transition-opacity" />

                  <div className="flex justify-between items-center">
                    <div className="flex items-start gap-4">
                      <div className="p-3 rounded-lg bg-slate-800/50 border border-white/5 group-hover:bg-slate-800 transition">
                        <Box className="w-6 h-6 text-slate-400 group-hover:text-cyan-400 transition-colors" />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-white flex items-center gap-2">
                          {env.name}
                          {isProd && (
                            <span className="text-[10px] bg-blue-500/20 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded font-mono">
                              PROD
                            </span>
                          )}
                          {isPr && (
                            <span className="text-[10px] bg-purple-500/20 text-purple-400 border border-purple-500/30 px-2 py-0.5 rounded font-mono">
                              PR
                            </span>
                          )}
                        </h3>
                        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                          <p className="text-xs text-slate-500 flex items-center gap-1.5 bg-white/5 px-2 py-0.5 rounded">
                            <Clock className="w-3 h-3" />
                            {env.created
                              ? formatDistanceToNow(new Date(env.created))
                              : 'Unknown'}{' '}
                            ago
                          </p>
                          <p className="text-xs text-slate-600 font-mono">
                            deploy/{env.deployment || 'unknown'}
                          </p>
                          <p className="text-xs text-cyan-400/80 flex items-center gap-1">
                            <DollarSign className="w-3 h-3" /> {formatUsd(env.costUsd)} spent
                          </p>
                          {env.savingsUsd > 0 && (
                            <p className="text-xs text-emerald-400/80 flex items-center gap-1">
                              <PiggyBank className="w-3 h-3" /> {formatUsd(env.savingsUsd)} saved
                            </p>
                          )}
                          {showCountdown && (
                            <p className="text-xs text-purple-400/80 flex items-center gap-1 bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 rounded">
                              <Moon className="w-3 h-3" /> auto-sleep in {formatCountdown(remainingMs)}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold border ${getStatusColor(env.status)}`}
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

                      <button
                        onClick={() => setSettingsFor(settingsFor === env.name ? null : env.name)}
                        className="p-2.5 rounded-lg border border-white/5 bg-slate-800/50 text-slate-400 hover:text-cyan-400 hover:border-cyan-500/30 transition-all active:scale-95"
                        title="Settings"
                      >
                        <SettingsIcon className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => toggleEnv(env)}
                        disabled={isLoading || !env.deployment}
                        className={`p-3 rounded-lg transition-all active:scale-95 border ${
                          isLoading || !env.deployment
                            ? 'opacity-50 cursor-not-allowed bg-slate-800/50 border-white/5 text-slate-600'
                            : env.status === 'ACTIVE'
                            ? 'bg-slate-800/50 border-white/5 text-slate-400 hover:text-amber-400 hover:border-amber-500/30 hover:bg-amber-500/10'
                            : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 hover:shadow-[0_0_15px_rgba(16,185,129,0.3)]'
                        }`}
                      >
                        {env.status === 'ACTIVE' ? (
                          <Pause className="w-5 h-5 fill-current" />
                        ) : (
                          <Play className="w-5 h-5 fill-current" />
                        )}
                      </button>
                    </div>
                  </div>

                  {settingsFor === env.name && (
                    <SettingsPanel env={env} onChange={(patch) => updateSettings(env.name, patch)} />
                  )}
                </div>
              );
            })}

            {envs.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 border-2 border-dashed border-white/5 rounded-xl bg-white/[0.02]">
                <div className="p-4 bg-slate-800/50 rounded-full mb-4">
                  <Server className="w-8 h-8 text-slate-600" />
                </div>
                <p className="text-slate-500 font-medium">No active environments found.</p>
                <p className="text-xs text-slate-600 mt-1">
                  Open a Pull Request to trigger a new deployment.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Audit Log */}
        <div className="lg:col-span-4 space-y-4">
          <div className="flex items-center justify-between px-1 mb-2">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <Terminal className="w-4 h-4" /> Operations Log
            </h2>
          </div>

          <div className="bg-[#0f1116] border border-white/10 rounded-xl p-0 overflow-hidden shadow-2xl">
            <div className="bg-white/5 px-4 py-2 flex items-center gap-2 border-b border-white/5">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/50" />
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/50" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-500/50" />
              <span className="ml-2 text-[10px] text-slate-600 font-mono">audit.log</span>
            </div>

            <div className="p-2 max-h-[600px] overflow-y-auto custom-scrollbar">
              <div className="space-y-1">
                {logs.map((log) => (
                  <div
                    key={log.id}
                    className="group flex gap-3 text-xs font-mono p-2 rounded hover:bg-white/5 transition-colors border-l-2 border-transparent hover:border-slate-600"
                  >
                    <div className="min-w-[70px] text-slate-600 text-[10px] pt-0.5">
                      {new Date(log.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`font-bold ${actionColor(log.action)}`}>{log.action}</span>
                        <span className="text-slate-600">➜</span>
                        <span className="text-slate-300 bg-white/5 px-1.5 rounded">
                          {log.namespace}
                        </span>
                      </div>
                      {log.reason && (
                        <p className="text-[10px] text-slate-600 mt-0.5">{log.reason}</p>
                      )}
                    </div>
                  </div>
                ))}
                {logs.length === 0 && (
                  <div className="text-xs text-slate-700 p-4 text-center">No logs recorded yet.</div>
                )}
              </div>
            </div>
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

function SettingsPanel({
  env,
  onChange,
}: {
  env: Env;
  onChange: (patch: Partial<Pick<Env, 'idleTimeoutMin' | 'autoSleepEnabled' | 'hourlyCostUsd'>>) => void;
}) {
  const [timeout_, setTimeout_] = useState(env.idleTimeoutMin);
  const [rate, setRate] = useState(env.hourlyCostUsd);

  return (
    <div className="mt-5 pt-5 border-t border-white/5 grid grid-cols-1 md:grid-cols-3 gap-4">
      <div>
        <label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
          Auto-sleep
        </label>
        <button
          onClick={() => onChange({ autoSleepEnabled: !env.autoSleepEnabled })}
          className={`mt-2 w-full px-3 py-2 rounded-lg text-xs font-semibold border transition ${
            env.autoSleepEnabled
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              : 'bg-slate-800/50 border-white/10 text-slate-400'
          }`}
        >
          {env.autoSleepEnabled ? 'ENABLED' : 'DISABLED'}
        </button>
      </div>

      <div>
        <label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
          Idle timeout: {timeout_} min
        </label>
        <input
          type="range"
          min={1}
          max={120}
          value={timeout_}
          onChange={(e) => setTimeout_(Number(e.target.value))}
          onMouseUp={() => onChange({ idleTimeoutMin: timeout_ })}
          onTouchEnd={() => onChange({ idleTimeoutMin: timeout_ })}
          className="mt-3 w-full accent-cyan-500"
        />
      </div>

      <div>
        <label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
          Hourly cost (USD)
        </label>
        <div className="mt-2 flex items-center gap-2">
          <input
            type="number"
            step={0.01}
            min={0}
            value={rate}
            onChange={(e) => setRate(Number(e.target.value))}
            className="w-full bg-slate-800/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500/30"
          />
          <button
            onClick={() => onChange({ hourlyCostUsd: rate })}
            className="px-3 py-2 rounded-lg text-xs font-semibold bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20"
          >
            Set
          </button>
        </div>
      </div>
    </div>
  );
}
