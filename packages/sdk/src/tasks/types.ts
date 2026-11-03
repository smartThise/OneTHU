export type TaskSchedule =
  | { kind: "interval"; everyMinutes: number }
  | { kind: "daily"; time: string; timezone: string }
  | { kind: "once"; runAt: string };
export type SchoolWatch = {
  kind: "school-watch"; courseIds: string[]; semesterId?: string;
  outputDir?: string; channels: string[]; remindBeforeHours?: number[];
};
export type OperationTask = { kind: "operation"; operation: string; args: unknown[]; channels?: string[] };
export type TaskTemplate = SchoolWatch | OperationTask;
export type TaskDraft = { name: string; schedule: TaskSchedule; template: TaskTemplate };
export type TaskOwner = { id: string; epoch: string | number };
export type TaskScope = { operations: string[]; outputDir?: string; channels: string[] };
export type TaskChange = { kind: "new" | "changed" | "removed" | "deadline"; id: string; title: string; courseId?: string; deadline?: string };
export type TaskRun = {
  id: string; taskId: string; startedAt: number; finishedAt?: number;
  status: "running" | "succeeded" | "partial" | "failed" | "cancelled" | "interrupted";
  changes: TaskChange[]; downloaded: number; notified: number; errors: string[];
};
export type TaskRecord = TaskDraft & {
  id: string; owner: string; revision: number; enabled: boolean;
  createdAt: number; updatedAt: number; nextRunAt: number | null;
  scope: TaskScope; lastRun?: TaskRun;
};
export type TaskSnapshotItem = { hash: string; title: string; courseId?: string; deadline?: string };
export type Attempt = { state: "pending" | "succeeded" | "unknown"; at: number };
export type StoredTask = TaskRecord & {
  approved: true; history: TaskRun[]; snapshot: Record<string, TaskSnapshotItem>;
  notifications: Record<string, Attempt>; downloads: Record<string, Attempt>;
};
export type TaskMigrationResult = { imported: string[]; skipped: string[]; conflicts: {id:string;reason:'id-conflict'|'capacity'}[]; ignored:number };
export type TaskState = { version: 1; tasks: StoredTask[]; migrations?: {origin:string;owner:string;ids:string[]}[] };
/** References are minted inside the manager and never accepted from JSON. Hosts
 * must call assertAllowed immediately before each final write/publication. */
export interface TaskGrant extends TaskScope {
  readonly taskId: string; readonly owner: string; readonly revision: number;
  assertActive(): Promise<void>;
  assertAllowed(operation: string, args: unknown[]): Promise<void>;
}
export type TaskOperation = { mutation: boolean; validate(args: unknown[]): void };
export interface TaskManagerPorts {
  storage: { load(): Promise<TaskState | null>; save(state: TaskState): Promise<void>; close?(): Promise<void> };
  getOwner(): TaskOwner | null | Promise<TaskOwner | null>;
  /** Trusted local approval. A public JSON confirmation flag is insufficient. */
  authorizeGrant(request: { action: "create" | "update" | "resume"; draft: TaskDraft; owner: string; scope: TaskScope }): Promise<boolean>;
  dispatch(operation: string, args: unknown[], options: { confirmationGrant: TaskGrant; signal: AbortSignal }): Promise<unknown>;
  notify(channel: string, message: string, idempotencyKey: string, options: { confirmationGrant: TaskGrant; signal: AbortSignal }): Promise<void>;
  /** Registration is host-owned; arbitrary operation names are never scheduled. */
  resolveOperation?(operation: string): TaskOperation | undefined;
  clock?: { now(): number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(timer: unknown): void };
}
export interface TaskManager {
  list(): Promise<TaskRecord[]>; get(id: string): Promise<TaskRecord>;
  create(draft: TaskDraft): Promise<TaskRecord>; update(id: string, draft: TaskDraft): Promise<TaskRecord>;
  pause(id: string): Promise<TaskRecord>; resume(id: string, options?: { rebind?: boolean }): Promise<TaskRecord>;
  remove(id: string): Promise<void>; run(id: string): Promise<TaskRun>; history(id: string): Promise<TaskRun[]>;
  /** Trusted host migration; excluded from the public operation catalog. */
  importState(origin:string,state:TaskState,channelMap?:Record<string,string>,options?:{replaceOwner?:boolean}):Promise<TaskMigrationResult>;
  tick(): Promise<void>; start(): void; stop(): Promise<void>; close(): Promise<void>;
}
