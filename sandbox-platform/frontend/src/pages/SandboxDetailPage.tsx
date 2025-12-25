import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Square, RotateCw, Trash2, Copy, ExternalLink, Clock } from 'lucide-react';
import {
  useSandbox,
  useStartSandbox,
  useStopSandbox,
  useRestartSandbox,
  useDestroySandbox,
  useReplicateSandbox,
} from '../hooks/useSandboxes';
import { useAuth } from '../hooks/useAuth';
import { Button } from '../components/Button';
import { Card, CardHeader } from '../components/Card';
import { StatusBadge, PhaseBadge } from '../components/Badge';
import { LogViewer } from '../components/LogViewer';
import { ProvisioningProgress } from '../components/ProvisioningProgress';
import { MetricsDisplay } from '../components/MetricsDisplay';
import { InteractiveTerminal } from '../components/InteractiveTerminal';

export function SandboxDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { token } = useAuth();
  const { data: sandbox, isLoading } = useSandbox(id);

  const startSandbox = useStartSandbox();
  const stopSandbox = useStopSandbox();
  const restartSandbox = useRestartSandbox();
  const destroySandbox = useDestroySandbox();
  const replicateSandbox = useReplicateSandbox();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!sandbox) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Sandbox not found</div>
      </div>
    );
  }

  const canStart = sandbox.status === 'stopped';
  const canStop = sandbox.status === 'running';
  const canRestart = sandbox.status === 'running';

  const handleDestroy = async () => {
    if (confirm('Are you sure you want to destroy this sandbox?')) {
      await destroySandbox.mutateAsync(sandbox.id);
      navigate('/');
    }
  };

  const handleReplicate = async () => {
    const newSandbox = await replicateSandbox.mutateAsync({ id: sandbox.id });
    navigate(`/sandboxes/${newSandbox.id}`);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Button variant="ghost" onClick={() => navigate('/')} className="mb-4">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Dashboard
        </Button>

        {/* Header */}
        <Card className="mb-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{sandbox.name}</h1>
              <p className="text-sm text-gray-500 font-mono mt-1">{sandbox.id}</p>
              <div className="flex items-center gap-3 mt-3">
                <StatusBadge status={sandbox.status} />
                <PhaseBadge phase={sandbox.phase} />
              </div>
            </div>
            <div className="flex gap-2">
              {canStart && (
                <Button
                  onClick={() => startSandbox.mutate(sandbox.id)}
                  isLoading={startSandbox.isPending}
                >
                  <Play className="w-4 h-4 mr-2" />
                  Start
                </Button>
              )}
              {canStop && (
                <Button
                  variant="secondary"
                  onClick={() => stopSandbox.mutate(sandbox.id)}
                  isLoading={stopSandbox.isPending}
                >
                  <Square className="w-4 h-4 mr-2" />
                  Stop
                </Button>
              )}
              {canRestart && (
                <Button
                  variant="secondary"
                  onClick={() => restartSandbox.mutate(sandbox.id)}
                  isLoading={restartSandbox.isPending}
                >
                  <RotateCw className="w-4 h-4 mr-2" />
                  Restart
                </Button>
              )}
              <Button variant="ghost" onClick={handleReplicate} isLoading={replicateSandbox.isPending}>
                <Copy className="w-4 h-4 mr-2" />
                Clone
              </Button>
              <Button variant="danger" onClick={handleDestroy} isLoading={destroySandbox.isPending}>
                <Trash2 className="w-4 h-4 mr-2" />
                Destroy
              </Button>
            </div>
          </div>
        </Card>

        {/* Provisioning Progress */}
        {(sandbox.status === 'pending' || sandbox.phase === 'creating' || sandbox.phase === 'starting' || sandbox.status === 'error') && (
          <div className="mb-6">
            <ProvisioningProgress
              status={sandbox.status}
              phase={sandbox.phase}
              progress={sandbox.provisionProgress}
              progressStatus={sandbox.provisionStatus}
              createdAt={sandbox.createdAt}
            />
          </div>
        )}

        {/* Endpoints */}
        {sandbox.endpoints.length > 0 && (
          <Card className="mb-6">
            <CardHeader title="Endpoints" description="Access your sandbox services" />
            <div className="space-y-2">
              {sandbox.endpoints.map((endpoint) => (
                <div
                  key={endpoint.port}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <ExternalLink className="w-4 h-4 text-gray-400" />
                    <span className="font-mono text-sm">{endpoint.url}</span>
                  </div>
                  <a
                    href={endpoint.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary-600 hover:text-primary-700 text-sm font-medium"
                  >
                    Open
                  </a>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Metrics */}
        <Card className="mb-6">
          <CardHeader
            title="Resource Metrics"
            description="Real-time CPU, memory, network, and I/O usage"
          />
          <MetricsDisplay sandboxId={sandbox.id} isRunning={sandbox.status === 'running'} />
        </Card>

        {/* Terminal */}
        <Card className="mb-6">
          <CardHeader
            title="Terminal"
            description="Interactive shell access to your sandbox"
          />
          <InteractiveTerminal
            sandboxId={sandbox.id}
            isRunning={sandbox.status === 'running'}
            token={token}
          />
        </Card>

        {/* Timeline */}
        <Card className="mb-6">
          <CardHeader title="Timeline" />
          <div className="space-y-3">
            <TimelineItem
              label="Created"
              timestamp={sandbox.createdAt}
              icon={<Clock className="w-4 h-4" />}
            />
            {sandbox.startedAt && (
              <TimelineItem
                label="Started"
                timestamp={sandbox.startedAt}
                icon={<Play className="w-4 h-4" />}
              />
            )}
            {sandbox.stoppedAt && (
              <TimelineItem
                label="Stopped"
                timestamp={sandbox.stoppedAt}
                icon={<Square className="w-4 h-4" />}
              />
            )}
            {sandbox.expiresAt && (
              <TimelineItem
                label="Expires"
                timestamp={sandbox.expiresAt}
                icon={<Clock className="w-4 h-4" />}
                isFuture
              />
            )}
          </div>
        </Card>

        {/* Logs */}
        <Card>
          <CardHeader title="Logs" description="Live log stream from your sandbox" />
          <LogViewer sandboxId={sandbox.id} maxHeight="500px" />
        </Card>
      </div>
    </div>
  );
}

interface TimelineItemProps {
  label: string;
  timestamp: string;
  icon: React.ReactNode;
  isFuture?: boolean;
}

function TimelineItem({ label, timestamp, icon, isFuture }: TimelineItemProps) {
  return (
    <div className="flex items-center gap-3">
      <div className={`p-2 rounded-full ${isFuture ? 'bg-yellow-100 text-yellow-600' : 'bg-gray-100 text-gray-600'}`}>
        {icon}
      </div>
      <div>
        <p className="text-sm font-medium text-gray-900">{label}</p>
        <p className="text-xs text-gray-500">{new Date(timestamp).toLocaleString()}</p>
      </div>
    </div>
  );
}
