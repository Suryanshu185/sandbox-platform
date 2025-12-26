import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Lock, Trash2 } from "lucide-react";
import {
  useEnvironment,
  useUpdateEnvironment,
  useSetSecret,
  useDeleteEnvironment,
} from "../hooks/useEnvironments";
import { useCreateSandbox } from "../hooks/useSandboxes";
import { Button } from "../components/Button";
import { Card, CardHeader } from "../components/Card";
import { Input } from "../components/Input";
import { EnvironmentForm } from "../components/EnvironmentForm";
import { Badge } from "../components/Badge";

export function EnvironmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: environment, isLoading } = useEnvironment(id);
  const updateEnv = useUpdateEnvironment();
  const setSecret = useSetSecret();
  const deleteEnv = useDeleteEnvironment();
  const createSandbox = useCreateSandbox();

  const [showEdit, setShowEdit] = useState(false);
  const [showAddSecret, setShowAddSecret] = useState(false);
  const [secretKey, setSecretKey] = useState("");
  const [secretValue, setSecretValue] = useState("");

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!environment) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Environment not found</div>
      </div>
    );
  }

  const handleUpdate = async (
    data: Parameters<typeof updateEnv.mutateAsync>[0]["data"],
  ) => {
    await updateEnv.mutateAsync({ id: environment.id, data });
    setShowEdit(false);
  };

  const handleAddSecret = async (e: React.FormEvent) => {
    e.preventDefault();
    await setSecret.mutateAsync({
      envId: environment.id,
      key: secretKey,
      value: secretValue,
    });
    setSecretKey("");
    setSecretValue("");
    setShowAddSecret(false);
  };

  const handleCreateSandbox = async () => {
    const sandbox = await createSandbox.mutateAsync({
      environmentId: environment.id,
    });
    navigate(`/sandboxes/${sandbox.id}`);
  };

  const handleDelete = async () => {
    if (confirm("Are you sure you want to delete this environment?")) {
      await deleteEnv.mutateAsync(environment.id);
      navigate("/");
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Button variant="ghost" onClick={() => navigate("/")} className="mb-4">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Dashboard
        </Button>

        <Card className="mb-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {environment.name}
              </h1>
              {environment.version && (
                <div className="flex items-center gap-2 mt-2">
                  <Badge variant="info">
                    Version {environment.version.version}
                  </Badge>
                  <span className="text-sm text-gray-500 font-mono">
                    {environment.version.image}
                  </span>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleCreateSandbox}
                isLoading={createSandbox.isPending}
              >
                <Plus className="w-4 h-4 mr-2" />
                Create Sandbox
              </Button>
              <Button
                variant="secondary"
                onClick={() => setShowEdit(!showEdit)}
              >
                {showEdit ? "Cancel" : "Edit"}
              </Button>
              <Button variant="danger" onClick={handleDelete}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {showEdit && environment.version && (
            <div className="mt-6 p-4 bg-gray-50 rounded-lg">
              <EnvironmentForm
                mode="edit"
                initialData={{
                  image: environment.version.image,
                  cpu: environment.version.cpu,
                  memory: environment.version.memory,
                  ports: environment.version.ports,
                  env: environment.version.env,
                }}
                onSubmit={handleUpdate}
                onCancel={() => setShowEdit(false)}
                isLoading={updateEnv.isPending}
              />
            </div>
          )}
        </Card>

        {environment.version && (
          <>
            {/* Configuration */}
            <Card className="mb-6">
              <CardHeader title="Configuration" />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h4 className="text-sm font-medium text-gray-500">CPU</h4>
                  <p className="text-lg">{environment.version.cpu} cores</p>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-gray-500">Memory</h4>
                  <p className="text-lg">{environment.version.memory} MB</p>
                </div>
              </div>

              {environment.version.ports.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-sm font-medium text-gray-500 mb-2">
                    Port Mappings
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {environment.version.ports.map((port, i) => (
                      <Badge key={i} variant="default">
                        {port.container} → {port.host}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {Object.keys(environment.version.env).length > 0 && (
                <div className="mt-4">
                  <h4 className="text-sm font-medium text-gray-500 mb-2">
                    Environment Variables
                  </h4>
                  <div className="bg-gray-900 rounded-md p-3 font-mono text-sm text-gray-100">
                    {Object.entries(environment.version.env).map(
                      ([key, value]) => (
                        <div key={key}>
                          <span className="text-blue-400">{key}</span>=
                          <span className="text-green-400">{value}</span>
                        </div>
                      ),
                    )}
                  </div>
                </div>
              )}
            </Card>

            {/* Secrets */}
            <Card>
              <CardHeader
                title="Secrets"
                description="Encrypted at rest, injected at runtime"
                action={
                  <Button
                    size="sm"
                    onClick={() => setShowAddSecret(!showAddSecret)}
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    Add Secret
                  </Button>
                }
              />

              {showAddSecret && (
                <form
                  onSubmit={handleAddSecret}
                  className="mb-4 p-4 bg-gray-50 rounded-lg space-y-3"
                >
                  <Input
                    label="Secret Key (UPPER_SNAKE_CASE)"
                    value={secretKey}
                    onChange={(e) => setSecretKey(e.target.value.toUpperCase())}
                    placeholder="API_KEY"
                    pattern="^[A-Z_][A-Z0-9_]*$"
                    required
                  />
                  <Input
                    label="Secret Value"
                    type="password"
                    value={secretValue}
                    onChange={(e) => setSecretValue(e.target.value)}
                    placeholder="Enter secret value"
                    required
                  />
                  <div className="flex gap-2">
                    <Button
                      type="submit"
                      size="sm"
                      isLoading={setSecret.isPending}
                    >
                      Save Secret
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => setShowAddSecret(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              )}

              {environment.version.secrets.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Lock className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                  <p>No secrets configured</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {environment.version.secrets.map((secret) => (
                    <div
                      key={secret.key}
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                    >
                      <div className="flex items-center gap-2">
                        <Lock className="w-4 h-4 text-gray-400" />
                        <span className="font-mono text-sm">{secret.key}</span>
                      </div>
                      <Badge variant="default">Encrypted</Badge>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
