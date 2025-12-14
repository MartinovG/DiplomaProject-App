"use client";
import { useEffect, useState } from 'react';
import axios from 'axios';
import { Play, Pause, Activity, Clock, Server, RefreshCw, Terminal, Layers, Box } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

export default function Dashboard() {
  const [envs, setEnvs] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const refreshData = async () => {
    try {
      const [envRes, logRes] = await Promise.all([
        axios.get(`${API_URL}/envs`),
        axios.get(`${API_URL}/history`)
      ]);
      setEnvs(envRes.data);
      setLogs(logRes.data);
    } catch (err) {
      console.error("Backend offline? Is port 4000 running?", err);
    }
  };

  useEffect(() => { refreshData(); }, []);

  const toggleEnv = async (env: any) => {
    setLoading(true);
    const action = env.status === 'ACTIVE' ? 'sleep' : 'wake';
    try {
      await axios.post(`${API_URL}/scale`, {
        namespace: env.name,
        deployment: env.deployment,
        action
      });
      setTimeout(refreshData, 800); // Slight delay for K8s to react
    } catch (e) {
      alert("Failed to scale. Check backend logs.");
    }
    setLoading(false);
  };

  // Helper for Status Badge
  const getStatusColor = (status: string) => {
    return status === 'ACTIVE' 
      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.2)]' 
      : 'bg-amber-500/10 text-amber-400 border-amber-500/20';
  };

  return (
    <main className="min-h-screen bg-[#0a0c10] text-slate-300 font-sans selection:bg-cyan-500/30">
      
      {/* Background Gradients */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-900/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-cyan-900/10 rounded-full blur-[120px]" />
      </div>

      <div className="relative max-w-7xl mx-auto p-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* HEADER */}
        <header className="lg:col-span-12 flex justify-between items-center mb-4 border-b border-white/5 pb-6">
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-lg shadow-lg shadow-cyan-500/20">
                <Layers className="w-6 h-6 text-white" />
              </div>
              Preview<span className="text-slate-500">Control</span>
            </h1>
            <p className="text-slate-500 text-sm mt-2 ml-1">Kubernetes Environment Lifecycle Manager</p>
          </div>
          <button 
            onClick={refreshData} 
            className="group flex items-center gap-2 text-xs font-medium bg-white/5 border border-white/10 px-4 py-2 rounded-full hover:bg-white/10 transition-all hover:border-white/20 active:scale-95"
          >
            <RefreshCw className="w-3.5 h-3.5 group-hover:rotate-180 transition-transform duration-500" /> 
            Sync Cluster
          </button>
        </header>

        {/* LEFT COLUMN: Environment Cards */}
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
            {envs.map((env) => (
              <div key={env.name} className="group relative bg-[#12141a] border border-white/5 rounded-xl p-5 hover:border-cyan-500/30 transition-all duration-300 hover:shadow-lg hover:shadow-cyan-900/10 overflow-hidden">
                
                {/* Decorative glow on hover */}
                <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-cyan-500 to-blue-600 opacity-0 group-hover:opacity-100 transition-opacity" />

                <div className="flex justify-between items-center">
                  <div className="flex items-start gap-4">
                    <div className="p-3 rounded-lg bg-slate-800/50 border border-white/5 group-hover:bg-slate-800 transition">
                      <Box className="w-6 h-6 text-slate-400 group-hover:text-cyan-400 transition-colors" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        {env.name}
                        {env.name === 'student-registry' && (
                          <span className="text-[10px] bg-blue-500/20 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded font-mono">PROD</span>
                        )}
                      </h3>
                      <div className="flex items-center gap-3 mt-1.5">
                        <p className="text-xs text-slate-500 flex items-center gap-1.5 bg-white/5 px-2 py-0.5 rounded">
                          <Clock className="w-3 h-3" /> 
                          {env.created ? formatDistanceToNow(new Date(env.created)) : 'Unknown'} ago
                        </p>
                        <p className="text-xs text-slate-600 font-mono">
                          deploy/{env.deployment || 'unknown'}
                        </p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-5">
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold border ${getStatusColor(env.status)}`}>
                      <span className="relative flex h-2 w-2">
                        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${env.status === 'ACTIVE' ? 'bg-emerald-400' : 'bg-amber-400'}`}></span>
                        <span className={`relative inline-flex rounded-full h-2 w-2 ${env.status === 'ACTIVE' ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
                      </span>
                      {env.status}
                    </div>
                    
                    <div className="h-8 w-px bg-white/10 mx-2" />

                    <button 
                      onClick={() => toggleEnv(env)}
                      disabled={loading}
                      className={`p-3 rounded-lg transition-all active:scale-95 border ${
                        env.status === 'ACTIVE' 
                        ? 'bg-slate-800/50 border-white/5 text-slate-400 hover:text-amber-400 hover:border-amber-500/30 hover:bg-amber-500/10' 
                        : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 hover:shadow-[0_0_15px_rgba(16,185,129,0.3)]'
                      }`}
                    >
                      {env.status === 'ACTIVE' ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}
                    </button>
                  </div>
                </div>
              </div>
            ))}
            
            {envs.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 border-2 border-dashed border-white/5 rounded-xl bg-white/[0.02]">
                <div className="p-4 bg-slate-800/50 rounded-full mb-4">
                  <Server className="w-8 h-8 text-slate-600" />
                </div>
                <p className="text-slate-500 font-medium">No active environments found.</p>
                <p className="text-xs text-slate-600 mt-1">Open a Pull Request to trigger a new deployment.</p>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Audit Logs */}
        <div className="lg:col-span-4 space-y-4">
          <div className="flex items-center justify-between px-1 mb-2">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <Terminal className="w-4 h-4" /> Operations Log
            </h2>
          </div>

          <div className="bg-[#0f1116] border border-white/10 rounded-xl p-0 overflow-hidden shadow-2xl">
            {/* Fake Terminal Header */}
            <div className="bg-white/5 px-4 py-2 flex items-center gap-2 border-b border-white/5">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/50" />
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/50" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-500/50" />
              <span className="ml-2 text-[10px] text-slate-600 font-mono">audit.log</span>
            </div>

            <div className="p-2 max-h-[600px] overflow-y-auto custom-scrollbar">
              <div className="space-y-1">
                {logs.map((log) => (
                  <div key={log.id} className="group flex gap-3 text-xs font-mono p-2 rounded hover:bg-white/5 transition-colors border-l-2 border-transparent hover:border-slate-600">
                    <div className="min-w-[70px] text-slate-600 text-[10px] pt-0.5">
                      {new Date(log.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`font-bold ${log.action === 'SLEEP' ? 'text-amber-500' : 'text-emerald-500'}`}>
                          {log.action}
                        </span> 
                        <span className="text-slate-600">➜</span>
                        <span className="text-slate-300 bg-white/5 px-1.5 rounded">
                          {log.namespace}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-600 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        Triggered via API
                      </p>
                    </div>
                  </div>
                ))}
                {logs.length === 0 && <div className="text-xs text-slate-700 p-4 text-center">No logs recorded yet.</div>}
              </div>
            </div>
          </div>
        </div>

      </div>
    </main>
  );
}