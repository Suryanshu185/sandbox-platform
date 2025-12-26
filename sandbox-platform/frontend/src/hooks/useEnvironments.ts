import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api";
import type { PortMapping } from "../types";

export function useEnvironments() {
  return useQuery({
    queryKey: ["environments"],
    queryFn: () => api.listEnvironments(),
  });
}

export function useEnvironment(id: string | undefined) {
  return useQuery({
    queryKey: ["environments", id],
    queryFn: () => api.getEnvironment(id!),
    enabled: !!id,
  });
}

export function useCreateEnvironment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      name: string;
      image: string;
      cpu?: number;
      memory?: number;
      ports?: PortMapping[];
      env?: Record<string, string>;
    }) => api.createEnvironment(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["environments"] });
    },
  });
}

export function useUpdateEnvironment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: Partial<{
        image: string;
        cpu: number;
        memory: number;
        ports: PortMapping[];
        env: Record<string, string>;
      }>;
    }) => api.updateEnvironment(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["environments"] });
      queryClient.invalidateQueries({ queryKey: ["environments", id] });
    },
  });
}

export function useDeleteEnvironment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.deleteEnvironment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["environments"] });
    },
  });
}

export function useSetSecret() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      envId,
      key,
      value,
    }: {
      envId: string;
      key: string;
      value: string;
    }) => api.setSecret(envId, key, value),
    onSuccess: (_, { envId }) => {
      queryClient.invalidateQueries({ queryKey: ["environments", envId] });
    },
  });
}
