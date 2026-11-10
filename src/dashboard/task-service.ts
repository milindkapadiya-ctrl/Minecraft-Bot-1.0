import type { SequenceRecord } from "../autonomy/collection-sequence.js";
import type { PilotRecord } from "../autonomy/pilot-evidence.js";
export interface TaskStatus {
  connection?: {
    connected: boolean;
    host: string;
    port: number;
    username: string;
    version: string;
    survival: boolean;
  };
  player?: {
    health: number;
    observedAt: string;
    position?: { x: number; y: number; z: number };
  };
  inventoryMeasuredAt?: string;
  selections?: {
    id: string;
    name: string;
    target: { x: number; y: number; z: number };
    expiresAt: string;
  }[];
  readiness?: { eligible: boolean; reason: string | null };
  mode: "SIMULATION" | "REAL_MINECRAFT_PREPARED" | "REAL_MINECRAFT";
  capabilities: TaskKind[];
  revision: number;
  sessionId: string;
  state: string;
  controller: "idle" | "busy" | "closed";
  inventory: { name: string; count: number }[];
  active: TaskRecord | null;
  history: TaskRecord[];
  verified: number;
  canReset: boolean;
}
/** Trusted compiled service, never constructed from browser input. */
export interface TaskService {
  snapshot(): TaskStatus;
  start(id: string, kind: TaskKind, selectionId?: string): TaskRecord;
  cancel(id: string): void;
  settled(): Promise<void>;
  reset(): void;
  close(): Promise<void>;
}
export const simulationTasks = [
  "inspect",
  "collect_one",
  "collect_three",
  "inventory",
  "look_left",
  "look_right",
  "look_up",
  "look_down",
  "dig_selected",
] as const;
export type TaskKind = (typeof simulationTasks)[number];
export interface TaskRecord {
  dig?: { serverConfirmedAir: boolean; inventoryEvidence: unknown };
  pilot?: PilotRecord;
  id: string;
  kind: TaskKind;
  sessionId: string;
  startedAt: string;
  completedAt?: string;
  outcome: string;
  reason: string;
  verified: number;
  events: { sequence: number; at: string; action: string; state: string }[];
  episodes: SequenceRecord["episodes"];
  blocks: { name: string; target: { x: number; y: number; z: number } }[];
}
