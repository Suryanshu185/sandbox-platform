import { Play, Square, RotateCw, Trash2, Copy, ExternalLink, Loader2 } from 'lucide-react';
import { Card } from './Card';
import { Button } from './Button';
import { StatusBadge, PhaseBadge } from './Badge';
import type { Sandbox } from '../types';

interface SandboxCardProps {
  sandbox: Sandbox;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onDestroy: () => void;
  onReplicate: () => void;
  onClick: () => void;
  isLoading?: boolean;
}

export function SandboxCard({
  sandbox,
  onStart,
  onStop,
  onRestart,
  onDestroy,
  onReplicate,
  onClick,
  isLoading,
}: SandboxCardProps) {
  const canStart = sandbox.status === 'stopped';
  const canStop = sandbox.status === 'running';
  const canRestart = sandbox.status === 'running';

  return (
    <Card className="hover:border-primary-300 transition-colors cursor-pointer" onClick={onClick}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-gray-900 truncate">{sandbox.name}</h4>
          <p className="text-xs text-gray-500 mt-1 font-mono">{sandbox.id.slice(0, 8)}</p>
        </div>
        <div className="flex items-center gap-2 ml-4">
          <StatusBadge status={sandbox.status} />
          <PhaseBadge phase={sandbox.phase} />
        </div>
      </div>

      {/* Provisioning indicator */}
      {(sandbox.status === 'pending' || sandbox.phase === 'creating' || sandbox.phase === 'starting') && (
        <div className="mt-3 flex items-center gap-2 text-blue-600 bg-blue-50 rounded-md px-3 py-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-xs font-medium">
            {sandbox.provisionStatus || (sandbox.phase === 'creating' ? 'Pulling image...' : sandbox.phase === 'starting' ? 'Starting container...' : 'Provisioning...')}
          </span>
          <div className="flex-1 h-1.5 bg-blue-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${sandbox.provisionProgress || 5}%` }}
            />
          </div>
          <span className="text-xs font-bold">{sandbox.provisionProgress || 0}%</span>
        </div>
      )}

      {sandbox.endpoints.length > 0 && sandbox.status === 'running' && (
        <div className="mt-3 flex flex-wrap gap-2">
          {sandbox.endpoints.map((endpoint) => (
            <a
              key={endpoint.port}
              href={endpoint.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center text-xs text-primary-600 hover:text-primary-700"
            >
              <ExternalLink className="w-3 h-3 mr-1" />
              Port {endpoint.port}
            </a>
          ))}
        </div>
      )}

      <div className="mt-3 text-xs text-gray-500 space-y-1">
        <div>Created: {new Date(sandbox.createdAt).toLocaleString()}</div>
        {sandbox.expiresAt && (
          <div>Expires: {new Date(sandbox.expiresAt).toLocaleString()}</div>
        )}
      </div>

      {sandbox.logsPreview && sandbox.logsPreview.length > 0 && (
        <div className="mt-3 bg-gray-900 rounded p-2 text-xs font-mono text-gray-300 max-h-20 overflow-hidden">
          {sandbox.logsPreview.slice(-3).map((line, i) => (
            <div key={i} className="truncate">{line}</div>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {canStart && (
          <Button size="sm" variant="secondary" onClick={onStart} disabled={isLoading}>
            <Play className="w-3 h-3 mr-1" />
            Start
          </Button>
        )}
        {canStop && (
          <Button size="sm" variant="secondary" onClick={onStop} disabled={isLoading}>
            <Square className="w-3 h-3 mr-1" />
            Stop
          </Button>
        )}
        {canRestart && (
          <Button size="sm" variant="secondary" onClick={onRestart} disabled={isLoading}>
            <RotateCw className="w-3 h-3 mr-1" />
            Restart
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onReplicate} disabled={isLoading}>
          <Copy className="w-3 h-3 mr-1" />
          Clone
        </Button>
        <Button size="sm" variant="danger" onClick={onDestroy} disabled={isLoading}>
          <Trash2 className="w-3 h-3 mr-1" />
          Destroy
        </Button>
      </div>
    </Card>
  );
}
