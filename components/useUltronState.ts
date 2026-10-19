"use client";
/**
 * useUltronState — live link from apex-ui to the ULTRON WebSocket bridge.
 *
 * Connects to ws://localhost:8788 (interfaces/ws_bridge.py) and exposes:
 *   connected : bridge reachable
 *   orbState  : "idle" | "thinking" | "speaking" | "standby" (drives the orb)
 *   nodes     : reasoning-web node roster {id: {status, detail}}
 *   label     : status-bar label (budget tier)
 *   standby   : STANDBY cluster on (budget critical/dead)
 *   events    : rolling transcript of raw orchestrator events
 *
 * When disconnected, the orb keeps its native tap cycle — ULTRON is an
 * overlay, not a takeover. Auto-reconnects with backoff.
 */
import { useEffect, useRef, useState } from "react";

const ORB_MAP: Record<string, string> = {
  idle: "idle",
  thinking: "thinking",
  speaking: "speaking",
  standby: "standby",
};

export function useUltronState(url = "ws://localhost:8788") {
  const [connected, setConnected] = useState(false);
  const [orbState, setOrbState] = useState<string | null>(null);
  const [nodes, setNodes] = useState<Record<string, { status: string; detail: string }>>({});
  const [label, setLabel] = useState("");
  const [standby, setStandby] = useState(false);
  const [events, setEvents] = useState<Record<string, unknown>[]>([]);
  const backoff = useRef(500);

  type BridgeMsg = {
    type: string; orb?: string; state?: string; id?: string;
    status?: string; detail?: string; label?: string;
    standby?: boolean; nodes?: Record<string, { status: string; detail: string }>;
    event?: Record<string, unknown>;
  };

  useEffect(() => {
    let ws: WebSocket | null = null;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (!alive) return;
      ws = new WebSocket(url);
      ws.onopen = () => {
        backoff.current = 500;
        setConnected(true);
      };
      ws.onmessage = (msg) => {
        let m: BridgeMsg;
        try { m = JSON.parse(msg.data) as BridgeMsg; } catch { return; }
        if (m.type === "snapshot") {
          setOrbState(ORB_MAP[m.orb ?? ""] ?? null);
          setNodes(m.nodes ?? {});
          setStandby(!!m.standby);
        } else if (m.type === "orb_state") {
          setOrbState(ORB_MAP[m.state ?? ""] ?? null);
        } else if (m.type === "node") {
          setNodes((prev) => ({ ...prev, [m.id ?? "unknown"]: { status: m.status ?? "", detail: m.detail ?? "" } }));
        } else if (m.type === "status_bar") {
          setStandby(!!m.standby);
          setLabel(m.label ?? "");
        } else if (m.type === "event" && m.event) {
          setEvents((prev) => [m.event as Record<string, unknown>, ...prev].slice(0, 40));
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (alive) timer = setTimeout(connect, backoff.current = Math.min(backoff.current * 2, 8000));
      };
      ws!.onerror = () => ws?.close();
    };
    connect();
    return () => {
      alive = false;
      clearTimeout(timer);
      ws && ws.close();
    };
  }, [url]);

  return { connected, orbState, nodes, label, standby, events };
}
