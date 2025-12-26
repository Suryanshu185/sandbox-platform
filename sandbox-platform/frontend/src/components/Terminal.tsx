import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Terminal as TerminalIcon, Send } from "lucide-react";
import { api } from "../api";

interface TerminalProps {
  sandboxId: string;
  isRunning: boolean;
}

interface HistoryEntry {
  command: string;
  output: string;
  exitCode: number;
  timestamp: Date;
}

export function Terminal({ sandboxId, isRunning }: TerminalProps) {
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const execMutation = useMutation({
    mutationFn: (cmd: string[]) => api.execInSandbox(sandboxId, cmd),
    onSuccess: (result, variables) => {
      setHistory((prev) => [
        ...prev,
        {
          command: variables.join(" "),
          output: result.output,
          exitCode: result.exitCode,
          timestamp: new Date(),
        },
      ]);
      setCommandHistory((prev) => [...prev, variables.join(" ")]);
      setHistoryIndex(-1);
    },
    onError: (error, variables) => {
      setHistory((prev) => [
        ...prev,
        {
          command: variables.join(" "),
          output: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
          exitCode: 1,
          timestamp: new Date(),
        },
      ]);
    },
  });

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [history]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim() || !isRunning) return;

    // Parse command into array (simple shell-like splitting)
    const parts = command.trim().split(/\s+/);
    execMutation.mutate(parts);
    setCommand("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (commandHistory.length === 0) return;
      const newIndex =
        historyIndex === -1
          ? commandHistory.length - 1
          : Math.max(0, historyIndex - 1);
      setHistoryIndex(newIndex);
      setCommand(commandHistory[newIndex]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex === -1) return;
      const newIndex = historyIndex + 1;
      if (newIndex >= commandHistory.length) {
        setHistoryIndex(-1);
        setCommand("");
      } else {
        setHistoryIndex(newIndex);
        setCommand(commandHistory[newIndex]);
      }
    }
  };

  if (!isRunning) {
    return (
      <div className="text-center py-8 text-gray-500">
        <TerminalIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p>Terminal available when sandbox is running</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 rounded-lg overflow-hidden">
      {/* Output */}
      <div
        ref={outputRef}
        className="h-64 overflow-auto p-4 font-mono text-sm"
        onClick={() => inputRef.current?.focus()}
      >
        {history.length === 0 && (
          <div className="text-gray-500">
            Type a command and press Enter to execute...
          </div>
        )}
        {history.map((entry, index) => (
          <div key={index} className="mb-3">
            <div className="flex items-center gap-2">
              <span className="text-green-400">$</span>
              <span className="text-white">{entry.command}</span>
            </div>
            {entry.output && (
              <pre
                className={`mt-1 whitespace-pre-wrap ${
                  entry.exitCode !== 0 ? "text-red-400" : "text-gray-300"
                }`}
              >
                {entry.output}
              </pre>
            )}
            {entry.exitCode !== 0 && (
              <div className="text-yellow-500 text-xs mt-1">
                Exit code: {entry.exitCode}
              </div>
            )}
          </div>
        ))}
        {execMutation.isPending && (
          <div className="flex items-center gap-2">
            <span className="text-green-400">$</span>
            <span className="text-white animate-pulse">Running...</span>
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="border-t border-gray-700">
        <div className="flex items-center px-4 py-2">
          <span className="text-green-400 mr-2">$</span>
          <input
            ref={inputRef}
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={execMutation.isPending}
            placeholder="Enter command..."
            className="flex-1 bg-transparent text-white outline-none font-mono text-sm placeholder-gray-600"
            autoFocus
          />
          <button
            type="submit"
            disabled={!command.trim() || execMutation.isPending}
            className="p-1 text-gray-400 hover:text-white disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </form>
    </div>
  );
}
