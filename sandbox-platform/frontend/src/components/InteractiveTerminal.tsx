import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

interface InteractiveTerminalProps {
  sandboxId: string;
  isRunning: boolean;
  token: string | null;
}

export function InteractiveTerminal({
  sandboxId,
  isRunning,
  token,
}: InteractiveTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [status, setStatus] = useState<
    "connecting" | "connected" | "disconnected" | "error"
  >("disconnected");

  useEffect(() => {
    if (!terminalRef.current || !isRunning || !token) return;

    // Create terminal with fixed rows to prevent cutoff
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      rows: 20,
      theme: {
        background: "#1a1b26",
        foreground: "#a9b1d6",
        cursor: "#c0caf5",
        cursorAccent: "#1a1b26",
        selectionBackground: "#33467c",
        black: "#32344a",
        red: "#f7768e",
        green: "#9ece6a",
        yellow: "#e0af68",
        blue: "#7aa2f7",
        magenta: "#ad8ee6",
        cyan: "#449dab",
        white: "#787c99",
        brightBlack: "#444b6a",
        brightRed: "#ff7a93",
        brightGreen: "#b9f27c",
        brightYellow: "#ff9e64",
        brightBlue: "#7da6ff",
        brightMagenta: "#bb9af7",
        brightCyan: "#0db9d7",
        brightWhite: "#acb0d0",
      },
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(terminalRef.current);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Connect WebSocket
    setStatus("connecting");
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(
      `${protocol}//${window.location.host}/ws/sandboxes/${sandboxId}/terminal?token=${token}`,
    );
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      term.writeln("\x1b[32mConnecting to sandbox...\x1b[0m");
    };

    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        // JSON control message
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "ready") {
            setStatus("connected");
            term.writeln("\x1b[32mConnected! Terminal ready.\x1b[0m\r\n");
            // Send initial resize
            ws.send(
              JSON.stringify({
                type: "resize",
                cols: term.cols,
                rows: term.rows,
              }),
            );
          } else if (msg.type === "error") {
            term.writeln(`\x1b[31mError: ${msg.message}\x1b[0m`);
          }
        } catch {
          // Not JSON, write as text
          term.write(event.data);
        }
      } else {
        // Binary data from terminal
        const data = new Uint8Array(event.data);
        term.write(data);
      }
    };

    ws.onerror = () => {
      setStatus("error");
      term.writeln("\x1b[31mWebSocket error\x1b[0m");
    };

    ws.onclose = () => {
      setStatus("disconnected");
      term.writeln("\r\n\x1b[33mConnection closed\x1b[0m");
    };

    // Send terminal input to WebSocket
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // Handle resize - only update cols, rows are fixed
    const handleResize = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "resize",
            cols: term.cols,
            rows: term.rows,
          }),
        );
      }
    };

    window.addEventListener("resize", handleResize);

    // Cleanup
    return () => {
      window.removeEventListener("resize", handleResize);
      ws.close();
      term.dispose();
    };
  }, [sandboxId, isRunning, token]);

  if (!isRunning) {
    return (
      <div className="bg-gray-900 rounded-lg p-8 text-center text-gray-400">
        <p>Terminal available when sandbox is running</p>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="absolute top-2 right-2 z-10">
        <span
          className={`inline-flex items-center px-2 py-1 text-xs rounded-full ${
            status === "connected"
              ? "bg-green-900 text-green-300"
              : status === "connecting"
                ? "bg-yellow-900 text-yellow-300"
                : status === "error"
                  ? "bg-red-900 text-red-300"
                  : "bg-gray-700 text-gray-300"
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full mr-1 ${
              status === "connected"
                ? "bg-green-400"
                : status === "connecting"
                  ? "bg-yellow-400 animate-pulse"
                  : status === "error"
                    ? "bg-red-400"
                    : "bg-gray-400"
            }`}
          />
          {status === "connected"
            ? "Connected"
            : status === "connecting"
              ? "Connecting..."
              : status === "error"
                ? "Error"
                : "Disconnected"}
        </span>
      </div>
      <div
        ref={terminalRef}
        className="bg-[#1a1b26] rounded-lg p-2 overflow-hidden"
      />
    </div>
  );
}
