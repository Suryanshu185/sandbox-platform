import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Box, Layers, Key, LogOut } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import {
  useEnvironments,
  useCreateEnvironment,
  useDeleteEnvironment,
} from "../hooks/useEnvironments";
import {
  useSandboxes,
  useStartSandbox,
  useStopSandbox,
  useRestartSandbox,
  useDestroySandbox,
  useReplicateSandbox,
  useCreateSandbox,
} from "../hooks/useSandboxes";
import { Button } from "../components/Button";
import { Card, CardHeader } from "../components/Card";
import { SandboxCard } from "../components/SandboxCard";
import { EnvironmentForm } from "../components/EnvironmentForm";
import { Badge } from "../components/Badge";
import type { Environment } from "../types";

export function DashboardPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [showNewEnv, setShowNewEnv] = useState(false);
  const [selectedEnvId, setSelectedEnvId] = useState<string | null>(null);

  const { data: environments = [], isLoading: envsLoading } = useEnvironments();
  const { data: sandboxes = [], isLoading: sandboxesLoading } = useSandboxes();

  const createEnv = useCreateEnvironment();
  const deleteEnv = useDeleteEnvironment();
  const createSandbox = useCreateSandbox();
  const startSandbox = useStartSandbox();
  const stopSandbox = useStopSandbox();
  const restartSandbox = useRestartSandbox();
  const destroySandbox = useDestroySandbox();
  const replicateSandbox = useReplicateSandbox();

  const handleCreateEnv = async (
    data: Parameters<typeof createEnv.mutateAsync>[0],
  ) => {
    await createEnv.mutateAsync(data);
    setShowNewEnv(false);
  };

  const handleCreateSandbox = async (environmentId: string) => {
    await createSandbox.mutateAsync({ environmentId });
  };

  const filteredSandboxes = selectedEnvId
    ? sandboxes.filter((s) => s.environmentId === selectedEnvId)
    : sandboxes;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <Box className="w-6 h-6 text-primary-600" />
              <span className="text-lg font-semibold text-gray-900">
                Sandbox Platform
              </span>
            </div>
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("/api-keys")}
              >
                <Key className="w-4 h-4 mr-2" />
                API Keys
              </Button>
              <span className="text-sm text-gray-500">{user?.email}</span>
              <Button variant="ghost" size="sm" onClick={logout}>
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Environments Section */}
          <div className="lg:col-span-1">
            <Card>
              <CardHeader
                title="Environments"
                description={`${environments.length} environment${environments.length !== 1 ? "s" : ""}`}
                action={
                  <Button size="sm" onClick={() => setShowNewEnv(true)}>
                    <Plus className="w-4 h-4 mr-1" />
                    New
                  </Button>
                }
              />

              {showNewEnv && (
                <div className="mb-4 p-4 bg-gray-50 rounded-lg">
                  <EnvironmentForm
                    onSubmit={handleCreateEnv}
                    onCancel={() => setShowNewEnv(false)}
                    isLoading={createEnv.isPending}
                  />
                </div>
              )}

              {envsLoading ? (
                <div className="text-center py-8 text-gray-500">Loading...</div>
              ) : environments.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Layers className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                  <p>No environments yet</p>
                  <p className="text-sm">Create one to get started</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {environments.map((env) => (
                    <EnvironmentItem
                      key={env.id}
                      environment={env}
                      isSelected={selectedEnvId === env.id}
                      onSelect={() =>
                        setSelectedEnvId(
                          selectedEnvId === env.id ? null : env.id,
                        )
                      }
                      onCreateSandbox={() => handleCreateSandbox(env.id)}
                      onDelete={() => deleteEnv.mutate(env.id)}
                      onClick={() => navigate(`/environments/${env.id}`)}
                    />
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* Sandboxes Section */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader
                title="Sandboxes"
                description={
                  selectedEnvId
                    ? `Filtered by environment`
                    : `${sandboxes.length} sandbox${sandboxes.length !== 1 ? "es" : ""}`
                }
                action={
                  selectedEnvId && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setSelectedEnvId(null)}
                    >
                      Clear Filter
                    </Button>
                  )
                }
              />

              {sandboxesLoading ? (
                <div className="text-center py-8 text-gray-500">Loading...</div>
              ) : filteredSandboxes.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Box className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                  <p>No sandboxes yet</p>
                  <p className="text-sm">
                    Create a sandbox from an environment
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredSandboxes.map((sandbox) => (
                    <SandboxCard
                      key={sandbox.id}
                      sandbox={sandbox}
                      onStart={() => startSandbox.mutate(sandbox.id)}
                      onStop={() => stopSandbox.mutate(sandbox.id)}
                      onRestart={() => restartSandbox.mutate(sandbox.id)}
                      onDestroy={() => destroySandbox.mutate(sandbox.id)}
                      onReplicate={() =>
                        replicateSandbox.mutate({ id: sandbox.id })
                      }
                      onClick={() => navigate(`/sandboxes/${sandbox.id}`)}
                      isLoading={
                        startSandbox.isPending ||
                        stopSandbox.isPending ||
                        restartSandbox.isPending
                      }
                    />
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}

interface EnvironmentItemProps {
  environment: Environment;
  isSelected: boolean;
  onSelect: () => void;
  onCreateSandbox: () => void;
  onDelete: () => void;
  onClick: () => void;
}

function EnvironmentItem({
  environment,
  isSelected,
  onSelect,
  onCreateSandbox,
  onDelete,
  onClick,
}: EnvironmentItemProps) {
  return (
    <div
      className={`p-3 rounded-lg border transition-colors cursor-pointer ${
        isSelected
          ? "border-primary-500 bg-primary-50"
          : "border-gray-200 hover:border-gray-300"
      }`}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between">
        <div
          className="flex-1 min-w-0"
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
        >
          <h4 className="text-sm font-medium text-gray-900 truncate">
            {environment.name}
          </h4>
          {environment.version && (
            <p className="text-xs text-gray-500 mt-1 font-mono truncate">
              {environment.version.image}
            </p>
          )}
        </div>
        {environment.version && (
          <Badge variant="info" size="sm">
            v{environment.version.version}
          </Badge>
        )}
      </div>

      {environment.version && (
        <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
          <span>{environment.version.cpu} CPU</span>
          <span>{environment.version.memory}MB</span>
        </div>
      )}

      <div className="mt-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" variant="primary" onClick={onCreateSandbox}>
          <Plus className="w-3 h-3 mr-1" />
          Sandbox
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete}>
          Delete
        </Button>
      </div>
    </div>
  );
}
