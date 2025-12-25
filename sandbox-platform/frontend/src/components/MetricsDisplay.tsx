import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Cpu, HardDrive, Network, Activity } from 'lucide-react';
import { api } from '../api';
import type { ContainerMetrics } from '../types';

interface MetricsDisplayProps {
  sandboxId: string;
  isRunning: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function ProgressBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
      <div
        className={`h-full ${color} transition-all duration-300`}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

export function MetricsDisplay({ sandboxId, isRunning }: MetricsDisplayProps) {
  const [metrics, setMetrics] = useState<ContainerMetrics | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['sandbox-metrics', sandboxId],
    queryFn: () => api.getSandboxMetrics(sandboxId),
    enabled: isRunning,
    refetchInterval: 2000, // Refresh every 2 seconds
  });

  useEffect(() => {
    if (data) {
      setMetrics(data);
    }
  }, [data]);

  if (!isRunning) {
    return (
      <div className="text-center py-8 text-gray-500">
        <Activity className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p>Metrics available when sandbox is running</p>
      </div>
    );
  }

  if (isLoading && !metrics) {
    return (
      <div className="text-center py-8 text-gray-500">
        <div className="animate-pulse">Loading metrics...</div>
      </div>
    );
  }

  if (error && !metrics) {
    return (
      <div className="text-center py-8 text-red-500">
        <p>Failed to load metrics</p>
      </div>
    );
  }

  if (!metrics) {
    return null;
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      {/* CPU */}
      <div className="p-4 bg-gray-50 rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <Cpu className="w-4 h-4 text-blue-500" />
          <span className="text-sm font-medium text-gray-700">CPU</span>
        </div>
        <div className="text-2xl font-bold text-gray-900 mb-1">
          {metrics.cpu.usagePercent.toFixed(1)}%
        </div>
        <ProgressBar value={metrics.cpu.usagePercent} color="bg-blue-500" />
      </div>

      {/* Memory */}
      <div className="p-4 bg-gray-50 rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <HardDrive className="w-4 h-4 text-green-500" />
          <span className="text-sm font-medium text-gray-700">Memory</span>
        </div>
        <div className="text-2xl font-bold text-gray-900 mb-1">
          {metrics.memory.usagePercent.toFixed(1)}%
        </div>
        <ProgressBar value={metrics.memory.usagePercent} color="bg-green-500" />
        <div className="text-xs text-gray-500 mt-1">
          {formatBytes(metrics.memory.usageBytes)} / {formatBytes(metrics.memory.limitBytes)}
        </div>
      </div>

      {/* Network */}
      <div className="p-4 bg-gray-50 rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <Network className="w-4 h-4 text-purple-500" />
          <span className="text-sm font-medium text-gray-700">Network</span>
        </div>
        <div className="flex justify-between text-sm">
          <div>
            <span className="text-gray-500">RX:</span>
            <span className="font-mono ml-1">{formatBytes(metrics.network.rxBytes)}</span>
          </div>
          <div>
            <span className="text-gray-500">TX:</span>
            <span className="font-mono ml-1">{formatBytes(metrics.network.txBytes)}</span>
          </div>
        </div>
      </div>

      {/* Block IO */}
      <div className="p-4 bg-gray-50 rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <Activity className="w-4 h-4 text-orange-500" />
          <span className="text-sm font-medium text-gray-700">Disk I/O</span>
        </div>
        <div className="flex justify-between text-sm">
          <div>
            <span className="text-gray-500">Read:</span>
            <span className="font-mono ml-1">{formatBytes(metrics.blockIO.readBytes)}</span>
          </div>
          <div>
            <span className="text-gray-500">Write:</span>
            <span className="font-mono ml-1">{formatBytes(metrics.blockIO.writeBytes)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
