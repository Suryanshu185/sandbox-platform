import { useState } from "react";
import { Button } from "./Button";
import { Input, TextArea } from "./Input";
import type { PortMapping } from "../types";

interface EnvironmentFormData {
  name: string;
  image: string;
  cpu: number;
  memory: number;
  ports: PortMapping[];
  env: Record<string, string>;
  command?: string[];
}

interface EnvironmentFormProps {
  initialData?: Partial<EnvironmentFormData>;
  onSubmit: (data: EnvironmentFormData) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
  mode?: "create" | "edit";
}

export function EnvironmentForm({
  initialData,
  onSubmit,
  onCancel,
  isLoading,
  mode = "create",
}: EnvironmentFormProps) {
  const [name, setName] = useState(initialData?.name ?? "");
  const [image, setImage] = useState(initialData?.image ?? "");
  const [cpu, setCpu] = useState(initialData?.cpu ?? 2);
  const [memory, setMemory] = useState(initialData?.memory ?? 512);
  const [portsStr, setPortsStr] = useState(
    initialData?.ports?.map((p) => `${p.container}:${p.host}`).join("\n") ?? "",
  );
  const [envStr, setEnvStr] = useState(
    Object.entries(initialData?.env ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join("\n"),
  );
  const [commandStr, setCommandStr] = useState(
    initialData?.command?.join(" ") ?? "",
  );
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      // Parse ports
      const ports: PortMapping[] = portsStr
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => {
          const [container, host] = line
            .split(":")
            .map((p) => parseInt(p.trim(), 10));
          if (isNaN(container!) || isNaN(host!)) {
            throw new Error(`Invalid port mapping: ${line}`);
          }
          return { container: container!, host: host! };
        });

      // Parse env
      const env: Record<string, string> = {};
      envStr
        .split("\n")
        .filter((line) => line.trim())
        .forEach((line) => {
          const idx = line.indexOf("=");
          if (idx === -1) {
            throw new Error(`Invalid env var: ${line}`);
          }
          const key = line.slice(0, idx).trim();
          const value = line.slice(idx + 1).trim();
          env[key] = value;
        });

      const command = commandStr.trim()
        ? commandStr.trim().split(/\s+/)
        : undefined;
      await onSubmit({ name, image, cpu, memory, ports, env, command });
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
          {error}
        </div>
      )}

      {mode === "create" && (
        <Input
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="my-environment"
          required
        />
      )}

      <Input
        label="Docker Image"
        value={image}
        onChange={(e) => setImage(e.target.value)}
        placeholder="nginx:alpine"
        required
      />

      <Input
        label="Command (optional)"
        value={commandStr}
        onChange={(e) => setCommandStr(e.target.value)}
        placeholder="sleep infinity"
      />

      <div className="grid grid-cols-2 gap-4">
        <Input
          label="CPU (cores)"
          type="number"
          min={0.25}
          max={4}
          step={0.25}
          value={cpu}
          onChange={(e) => setCpu(parseFloat(e.target.value))}
        />
        <Input
          label="Memory (MB)"
          type="number"
          min={128}
          max={2048}
          step={64}
          value={memory}
          onChange={(e) => setMemory(parseInt(e.target.value, 10))}
        />
      </div>

      <TextArea
        label="Port Mappings (container:host, one per line)"
        value={portsStr}
        onChange={(e) => setPortsStr(e.target.value)}
        placeholder="80:8080&#10;443:8443"
        rows={3}
      />

      <TextArea
        label="Environment Variables (KEY=value, one per line)"
        value={envStr}
        onChange={(e) => setEnvStr(e.target.value)}
        placeholder="NODE_ENV=production&#10;PORT=3000"
        rows={3}
      />

      <div className="flex justify-end gap-3 pt-4">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" isLoading={isLoading}>
          {mode === "create" ? "Create Environment" : "Update Environment"}
        </Button>
      </div>
    </form>
  );
}
