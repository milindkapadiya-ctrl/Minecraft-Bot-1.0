import type { SequenceRecord } from "../autonomy/collection-sequence.js";
import type { PilotRecord } from "../autonomy/pilot-evidence.js";
export interface TaskStatus {
  mode: "SIMULATION" | "REAL_MINECRAFT_PREPARED";
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
  start(id: string, kind: TaskKind): TaskRecord;
  cancel(id: string): void;
  settled(): Promise<void>;
  reset(): void;
  close(): Promise<void>;
}
export type TaskKind = "inspect" | "collect_one" | "collect_three";
export interface TaskRecord {
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
