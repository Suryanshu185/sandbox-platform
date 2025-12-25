import { useEffect, useRef } from 'react';
import clsx from 'clsx';
import { useSandboxLogs } from '../hooks/useSandboxes';

interface LogViewerProps {
  sandboxId: string;
  className?: string;
  maxHeight?: string;
}

export function LogViewer({ sandboxId, className, maxHeight = '400px' }: LogViewerProps) {
  const { logs, isConnected, clearLogs } = useSandboxLogs(sandboxId);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (containerRef.current && autoScrollRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  // Detect if user scrolled up (disable auto-scroll)
  const handleScroll = () => {
    if (containerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
      autoScrollRef.current = scrollTop + clientHeight >= scrollHeight - 50;
    }
  };

  return (
    <div className={clsx('flex flex-col', className)}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={clsx('w-2 h-2 rounded-full', isConnected ? 'bg-green-500' : 'bg-gray-400')} />
          <span className="text-xs text-gray-500">
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
        <button
          onClick={clearLogs}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          Clear
        </button>
      </div>

      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="bg-gray-900 text-gray-100 rounded-md p-3 font-mono text-xs overflow-auto"
        style={{ maxHeight }}
      >
        {logs.length === 0 ? (
          <div className="text-gray-500 italic">No logs yet...</div>
        ) : (
          logs.map((log, index) => (
            <div
              key={`${log.timestamp}-${index}`}
              className={clsx('whitespace-pre-wrap break-all', {
                'text-red-400': log.type === 'stderr',
              })}
            >
              <span className="text-gray-500">
                [{new Date(log.timestamp).toLocaleTimeString()}]
              </span>{' '}
              <span className={clsx('font-medium', log.type === 'stderr' ? 'text-red-500' : 'text-green-500')}>
                [{log.type}]
              </span>{' '}
              {log.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
