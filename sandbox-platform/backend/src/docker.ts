import Docker from 'dockerode';
import { Readable } from 'stream';
import logger from './logger.js';
import type { PortMapping } from './types.js';

const docker = new Docker({
  socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock',
});

export interface ContainerConfig {
  name: string;
  image: string;
  cpu: number;
  memory: number;
  ports: PortMapping[];
  env: Record<string, string>;
  labels?: Record<string, string>;
  command?: string[];
}

export interface ContainerInfo {
  id: string;
  status: string;
  running: boolean;
  exitCode: number | null;
}

// Progress callback type
export type ProgressCallback = (progress: number, status: string) => void;

// Ensure image exists (pull if needed) with progress tracking
export async function ensureImage(
  image: string,
  onProgress?: ProgressCallback
): Promise<void> {
  const log = logger.child({ image });

  try {
    await docker.getImage(image).inspect();
    log.debug('Image already exists locally');
    onProgress?.(100, 'Image ready');
  } catch {
    log.info('Pulling image...');
    onProgress?.(0, 'Starting pull');
    const stream = await docker.pull(image);

    await new Promise<void>((resolve, reject) => {
      const layerProgress: Record<string, { current: number; total: number }> = {};

      docker.modem.followProgress(
        stream,
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        },
        (event: { id?: string; status?: string; progressDetail?: { current?: number; total?: number } }) => {
          // Track progress per layer
          if (event.id && event.progressDetail?.total) {
            layerProgress[event.id] = {
              current: event.progressDetail.current || 0,
              total: event.progressDetail.total,
            };
          }

          // Calculate total progress
          const layers = Object.values(layerProgress);
          if (layers.length > 0) {
            const totalBytes = layers.reduce((sum, l) => sum + l.total, 0);
            const downloadedBytes = layers.reduce((sum, l) => sum + l.current, 0);
            const percent = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0;
            onProgress?.(percent, event.status || 'Downloading');
          }
        }
      );
    });

    log.info('Image pulled successfully');
    onProgress?.(100, 'Pull complete');
  }
}

// Create and start a container
export async function createContainer(
  config: ContainerConfig,
  onProgress?: ProgressCallback
): Promise<string> {
  const log = logger.child({ containerName: config.name });

  await ensureImage(config.image, onProgress);

  // Convert port mappings to Docker format
  const exposedPorts: Record<string, object> = {};
  const portBindings: Record<string, Array<{ HostPort: string }>> = {};

  for (const port of config.ports) {
    const containerPort = `${port.container}/tcp`;
    exposedPorts[containerPort] = {};
    portBindings[containerPort] = [{ HostPort: String(port.host) }];
  }

  // Convert env to array format
  const envArray = Object.entries(config.env).map(([k, v]) => `${k}=${v}`);

  const container = await docker.createContainer({
    name: config.name,
    Image: config.image,
    Cmd: config.command,
    Env: envArray,
    ExposedPorts: exposedPorts,
    Labels: {
      'sandbox-platform': 'true',
      ...config.labels,
    },
    HostConfig: {
      PortBindings: portBindings,
      // Resource limits
      CpuPeriod: 100000,
      CpuQuota: Math.floor(config.cpu * 100000),
      Memory: config.memory * 1024 * 1024, // Convert MB to bytes
      MemorySwap: config.memory * 1024 * 1024, // No swap
      // Security
      ReadonlyRootfs: false,
      SecurityOpt: ['no-new-privileges'],
      CapDrop: ['ALL'],
      CapAdd: ['CHOWN', 'SETUID', 'SETGID'], // Minimal caps for most apps
      // No host mounts - explicit allow-list only
      Binds: [],
      // Network isolation
      NetworkMode: 'bridge',
      // Auto-remove on stop (cleanup)
      AutoRemove: false,
    },
    // Run as non-root if possible (user can override in Dockerfile)
    User: '',
    Tty: false,
    AttachStdout: true,
    AttachStderr: true,
    OpenStdin: false,
  });

  log.info({ containerId: container.id }, 'Container created');
  return container.id;
}

// Start a container
export async function startContainer(containerId: string): Promise<void> {
  const container = docker.getContainer(containerId);
  await container.start();
  logger.info({ containerId }, 'Container started');
}

// Stop a container gracefully
export async function stopContainer(containerId: string, timeout = 10): Promise<void> {
  const container = docker.getContainer(containerId);
  try {
    await container.stop({ t: timeout });
    logger.info({ containerId }, 'Container stopped');
  } catch (err: unknown) {
    const error = err as { statusCode?: number };
    // Container might already be stopped
    if (error.statusCode === 304) {
      logger.debug({ containerId }, 'Container already stopped');
    } else {
      throw err;
    }
  }
}

// Restart a container
export async function restartContainer(containerId: string): Promise<void> {
  const container = docker.getContainer(containerId);
  await container.restart({ t: 10 });
  logger.info({ containerId }, 'Container restarted');
}

// Remove a container (force)
export async function removeContainer(containerId: string): Promise<void> {
  const container = docker.getContainer(containerId);
  try {
    await container.remove({ force: true, v: true });
    logger.info({ containerId }, 'Container removed');
  } catch (err: unknown) {
    const error = err as { statusCode?: number };
    // Container might not exist
    if (error.statusCode === 404) {
      logger.debug({ containerId }, 'Container not found, already removed');
    } else {
      throw err;
    }
  }
}

// Get container info
export async function getContainerInfo(containerId: string): Promise<ContainerInfo | null> {
  try {
    const container = docker.getContainer(containerId);
    const info = await container.inspect();

    return {
      id: info.Id,
      status: info.State.Status,
      running: info.State.Running,
      exitCode: info.State.ExitCode,
    };
  } catch (err: unknown) {
    const error = err as { statusCode?: number };
    if (error.statusCode === 404) {
      return null;
    }
    throw err;
  }
}

// Wait for container to be healthy (basic check - wait for it to start)
export async function waitForHealthy(containerId: string, timeoutMs = 30000): Promise<boolean> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const info = await getContainerInfo(containerId);

    if (!info) {
      return false;
    }

    if (info.running) {
      // Simple health check: container is running
      // For production, implement proper health checks via HEALTHCHECK in Dockerfile
      return true;
    }

    if (info.status === 'exited' || info.status === 'dead') {
      return false;
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  return false;
}

// Stream container logs
export async function* streamLogs(
  containerId: string,
  since?: number
): AsyncGenerator<{ type: 'stdout' | 'stderr'; text: string; timestamp: Date }> {
  const container = docker.getContainer(containerId);

  const logStream = await container.logs({
    follow: true,
    stdout: true,
    stderr: true,
    timestamps: true,
    since: since ?? 0,
  });

  // Docker multiplexes stdout/stderr with a header
  // Header: [stream_type(1), 0, 0, 0, size(4 bytes big-endian)]
  const readable = logStream as unknown as Readable;

  let buffer = Buffer.alloc(0);

  for await (const chunk of readable) {
    buffer = Buffer.concat([buffer, chunk as Buffer]);

    while (buffer.length >= 8) {
      const header = buffer.subarray(0, 8);
      const streamType = header[0];
      const size = header.readUInt32BE(4);

      if (buffer.length < 8 + size) {
        break; // Wait for more data
      }

      const payload = buffer.subarray(8, 8 + size).toString('utf8');
      buffer = buffer.subarray(8 + size);

      // Parse timestamp from log line (Docker adds it when timestamps: true)
      const match = payload.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\s(.*)$/s);
      const timestamp = match ? new Date(match[1]!) : new Date();
      const text = match ? match[2]! : payload;

      yield {
        type: streamType === 1 ? 'stdout' : 'stderr',
        text: text.trimEnd(),
        timestamp,
      };
    }
  }
}

// Get recent logs (non-streaming)
export async function getLogs(
  containerId: string,
  tail = 100
): Promise<Array<{ type: 'stdout' | 'stderr'; text: string; timestamp: Date }>> {
  const container = docker.getContainer(containerId);

  const logs = await container.logs({
    follow: false,
    stdout: true,
    stderr: true,
    timestamps: true,
    tail,
  });

  const result: Array<{ type: 'stdout' | 'stderr'; text: string; timestamp: Date }> = [];
  let buffer = Buffer.isBuffer(logs) ? logs : Buffer.from(logs);

  while (buffer.length >= 8) {
    const header = buffer.subarray(0, 8);
    const streamType = header[0];
    const size = header.readUInt32BE(4);

    if (buffer.length < 8 + size) {
      break;
    }

    const payload = buffer.subarray(8, 8 + size).toString('utf8');
    buffer = buffer.subarray(8 + size);

    const match = payload.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\s(.*)$/s);
    const timestamp = match ? new Date(match[1]!) : new Date();
    const text = match ? match[2]! : payload;

    result.push({
      type: streamType === 1 ? 'stdout' : 'stderr',
      text: text.trimEnd(),
      timestamp,
    });
  }

  return result;
}

// Docker health check
export async function healthCheck(): Promise<boolean> {
  try {
    await docker.ping();
    return true;
  } catch {
    return false;
  }
}

// Container metrics interface
export interface ContainerMetrics {
  cpu: {
    usagePercent: number;
    systemUsage: number;
    containerUsage: number;
  };
  memory: {
    usageBytes: number;
    limitBytes: number;
    usagePercent: number;
  };
  network: {
    rxBytes: number;
    txBytes: number;
  };
  blockIO: {
    readBytes: number;
    writeBytes: number;
  };
  timestamp: string;
}

// Get container stats (CPU, RAM, Network, IO)
export async function getContainerStats(containerId: string): Promise<ContainerMetrics | null> {
  try {
    const container = docker.getContainer(containerId);
    const stats = await container.stats({ stream: false });

    // Calculate CPU percentage
    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const cpuCount = stats.cpu_stats.online_cpus || 1;
    const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * cpuCount * 100 : 0;

    // Memory stats
    const memUsage = stats.memory_stats.usage || 0;
    const memLimit = stats.memory_stats.limit || 1;
    const memPercent = (memUsage / memLimit) * 100;

    // Network stats (sum all interfaces)
    let rxBytes = 0;
    let txBytes = 0;
    if (stats.networks) {
      for (const net of Object.values(stats.networks) as Array<{ rx_bytes: number; tx_bytes: number }>) {
        rxBytes += net.rx_bytes || 0;
        txBytes += net.tx_bytes || 0;
      }
    }

    // Block IO stats
    let readBytes = 0;
    let writeBytes = 0;
    if (stats.blkio_stats?.io_service_bytes_recursive) {
      for (const io of stats.blkio_stats.io_service_bytes_recursive) {
        if (io.op === 'read' || io.op === 'Read') readBytes += io.value;
        if (io.op === 'write' || io.op === 'Write') writeBytes += io.value;
      }
    }

    return {
      cpu: {
        usagePercent: Math.round(cpuPercent * 100) / 100,
        systemUsage: stats.cpu_stats.system_cpu_usage,
        containerUsage: stats.cpu_stats.cpu_usage.total_usage,
      },
      memory: {
        usageBytes: memUsage,
        limitBytes: memLimit,
        usagePercent: Math.round(memPercent * 100) / 100,
      },
      network: {
        rxBytes,
        txBytes,
      },
      blockIO: {
        readBytes,
        writeBytes,
      },
      timestamp: new Date().toISOString(),
    };
  } catch (err: unknown) {
    const error = err as { statusCode?: number };
    if (error.statusCode === 404 || error.statusCode === 409) {
      return null; // Container not found or not running
    }
    throw err;
  }
}

// Execute command in container (for SSH-like access)
export async function execInContainer(
  containerId: string,
  cmd: string[]
): Promise<{ exitCode: number; output: string }> {
  const container = docker.getContainer(containerId);

  const exec = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
  });

  const stream = await exec.start({ hijack: true, stdin: false });

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    stream.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    stream.on('end', async () => {
      const output = Buffer.concat(chunks).toString('utf8');
      const inspectResult = await exec.inspect();
      resolve({
        exitCode: inspectResult.ExitCode ?? 0,
        output,
      });
    });

    stream.on('error', reject);
  });
}

// List all sandbox containers
export async function listSandboxContainers(): Promise<Docker.ContainerInfo[]> {
  return docker.listContainers({
    all: true,
    filters: {
      label: ['sandbox-platform=true'],
    },
  });
}

// Interactive exec session for terminal access
export interface ExecSession {
  stream: NodeJS.ReadWriteStream;
  resize: (cols: number, rows: number) => Promise<void>;
  close: () => void;
}

export async function createInteractiveExec(
  containerId: string,
  cols = 80,
  rows = 24
): Promise<ExecSession> {
  const container = docker.getContainer(containerId);

  const exec = await container.exec({
    Cmd: ['/bin/sh'],
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
  });

  const stream = await exec.start({
    hijack: true,
    stdin: true,
    Tty: true,
  });

  // Set initial terminal size
  await exec.resize({ h: rows, w: cols });

  return {
    stream,
    resize: async (newCols: number, newRows: number) => {
      await exec.resize({ h: newRows, w: newCols });
    },
    close: () => {
      stream.end();
    },
  };
}

export { docker };
