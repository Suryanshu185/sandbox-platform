import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Key, Trash2, Copy, Check } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api';
import { Button } from '../components/Button';
import { Card, CardHeader } from '../components/Card';
import { Input } from '../components/Input';
import type { ApiKey } from '../types';

export function ApiKeysPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: apiKeys = [], isLoading } = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => api.listApiKeys(),
  });

  const createKey = useMutation({
    mutationFn: (name: string) => api.createApiKey(name),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      setNewKey(data.key!);
      setName('');
      setShowCreate(false);
    },
  });

  const revokeKey = useMutation({
    mutationFn: (id: string) => api.revokeApiKey(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });

  const handleCopy = async () => {
    if (newKey) {
      await navigator.clipboard.writeText(newKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await createKey.mutateAsync(name);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Button variant="ghost" onClick={() => navigate('/')} className="mb-4">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Dashboard
        </Button>

        <Card>
          <CardHeader
            title="API Keys"
            description="Manage your API keys for programmatic access"
            action={
              <Button onClick={() => setShowCreate(true)}>
                <Plus className="w-4 h-4 mr-2" />
                New API Key
              </Button>
            }
          />

          {/* New key display */}
          {newKey && (
            <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm text-green-800 font-medium mb-2">
                API key created! Copy it now - you won't be able to see it again.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-white px-3 py-2 rounded border font-mono text-sm break-all">
                  {newKey}
                </code>
                <Button size="sm" variant="secondary" onClick={handleCopy}>
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="mt-2"
                onClick={() => setNewKey(null)}
              >
                Dismiss
              </Button>
            </div>
          )}

          {/* Create form */}
          {showCreate && (
            <form onSubmit={handleCreate} className="mb-6 p-4 bg-gray-50 rounded-lg">
              <Input
                label="Key Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Production API Key"
                required
              />
              <div className="mt-3 flex gap-2">
                <Button type="submit" size="sm" isLoading={createKey.isPending}>
                  Create Key
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setShowCreate(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}

          {/* Keys list */}
          {isLoading ? (
            <div className="text-center py-8 text-gray-500">Loading...</div>
          ) : apiKeys.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Key className="w-12 h-12 mx-auto mb-2 text-gray-300" />
              <p>No API keys yet</p>
              <p className="text-sm">Create one to access the API programmatically</p>
            </div>
          ) : (
            <div className="space-y-3">
              {apiKeys.map((key) => (
                <ApiKeyItem
                  key={key.id}
                  apiKey={key}
                  onRevoke={() => revokeKey.mutate(key.id)}
                  isRevoking={revokeKey.isPending}
                />
              ))}
            </div>
          )}
        </Card>

        {/* Usage instructions */}
        <Card className="mt-6">
          <CardHeader title="Usage" description="How to use your API key" />
          <div className="bg-gray-900 rounded-md p-4 font-mono text-sm text-gray-100">
            <p className="text-gray-400"># Make API requests with your key</p>
            <p className="mt-2">
              curl -H "Authorization: Bearer <span className="text-green-400">sk_live_...</span>" \
            </p>
            <p className="ml-4">https://api.sandbox.example.com/sandboxes</p>
          </div>
        </Card>
      </div>
    </div>
  );
}

interface ApiKeyItemProps {
  apiKey: ApiKey;
  onRevoke: () => void;
  isRevoking: boolean;
}

function ApiKeyItem({ apiKey, onRevoke, isRevoking }: ApiKeyItemProps) {
  return (
    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
      <div className="flex items-center gap-3">
        <Key className="w-5 h-5 text-gray-400" />
        <div>
          <p className="font-medium text-gray-900">{apiKey.name}</p>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <code className="bg-gray-200 px-2 py-0.5 rounded">{apiKey.keyPrefix}...</code>
            <span>Created {new Date(apiKey.createdAt).toLocaleDateString()}</span>
            {apiKey.lastUsedAt && (
              <span>Last used {new Date(apiKey.lastUsedAt).toLocaleDateString()}</span>
            )}
          </div>
        </div>
      </div>
      <Button
        size="sm"
        variant="danger"
        onClick={onRevoke}
        isLoading={isRevoking}
      >
        <Trash2 className="w-4 h-4 mr-1" />
        Revoke
      </Button>
    </div>
  );
}
