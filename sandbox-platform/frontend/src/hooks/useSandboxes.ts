import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api';
import type { Sandbox, PortMapping, LogEntry } from '../types';

export function useSandboxes(filters?: { status?: string; environmentId?: string }) {
  return useQuery({
    queryKey: ['sandboxes', filters],
    queryFn: () => api.listSandboxes(filters),
    refetchInterval: 5000, // Poll every 5 seconds for status updates
  });
}

export function useSandbox(id: string | undefined) {
  return useQuery({
    queryKey: ['sandboxes', id],
    queryFn: () => api.getSandbox(id!),
    enabled: !!id,
    refetchInterval: (query) => {
      // Poll faster during provisioning
      const data = query.state.data as Sandbox | undefined;
      if (data?.status === 'pending' || data?.phase === 'creating' || data?.phase === 'starting') {
        return 1000; // 1 second during provisioning
      }
      return 5000; // 5 seconds otherwise
    },
  });
}

export function useCreateSandbox() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      environmentId: string;
      environmentVersionId?: string;
      name?: string;
      ttlSeconds?: number;
      overrides?: {
        env?: Record<string, string>;
        ports?: PortMapping[];
      };
    }) => api.createSandbox(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sandboxes'] });
    },
  });
}

export function useStartSandbox() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.startSandbox(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['sandboxes'] });
      queryClient.invalidateQueries({ queryKey: ['sandboxes', id] });
    },
  });
}

export function useStopSandbox() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.stopSandbox(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['sandboxes'] });
      queryClient.invalidateQueries({ queryKey: ['sandboxes', id] });
    },
  });
}

export function useRestartSandbox() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.restartSandbox(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['sandboxes'] });
      queryClient.invalidateQueries({ queryKey: ['sandboxes', id] });
    },
  });
}

export function useDestroySandbox() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.destroySandbox(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sandboxes'] });
    },
  });
}

export function useReplicateSandbox() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data?: {
        name?: string;
        overrides?: {
          env?: Record<string, string>;
          ports?: PortMapping[];
        };
      };
    }) => api.replicateSandbox(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sandboxes'] });
    },
  });
}

export function useSandboxLogs(id: string | undefined, enabled = true) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // Initial log fetch
  const { data: initialLogs } = useQuery({
    queryKey: ['sandbox-logs', id],
    queryFn: () => api.getSandboxLogs(id!, 100),
    enabled: !!id && enabled,
  });

  useEffect(() => {
    if (initialLogs) {
      setLogs(initialLogs);
    }
  }, [initialLogs]);

  // WebSocket connection
  useEffect(() => {
    if (!id || !enabled) return;

    const ws = api.createLogStream(id);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.event === 'log') {
          setLogs((prev) => [...prev.slice(-999), message.data]);
        }
      } catch {
        // Ignore parse errors
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
    };

    ws.onerror = () => {
      setIsConnected(false);
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [id, enabled]);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  return { logs, isConnected, clearLogs };
}
