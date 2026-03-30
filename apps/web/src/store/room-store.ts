/**
 * room-store.ts — Room + OpenSpec 状态管理
 *
 * 独立于现有 office-store，避免污染现有代码。
 * 两个 store 并行运行，通过事件同步。
 */
import { create } from "zustand";
import type {
  SpecPhase,
  ClawState,
  ClawEvent,
  RoomInvite,
} from "@office/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpecTaskState {
  taskId: string;
  description: string;
  status: string;
  assignee?: string;
}

export interface SpecFileState {
  path: string;
  content: string;
  updatedAt: number;
  updatedBy?: string;
}

export interface RoomInfo {
  roomId: string;
  name: string;
  owner: string;
  clawCount: number;
  specPhase: SpecPhase | null;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface RoomStore {
  // ── Room 状态 ──
  currentRoomId: string | null;
  currentRoomName: string | null;
  rooms: RoomInfo[];

  // ── Claw 列表（房间内的参与者）──
  claws: Map<string, ClawState>;

  // ── OpenSpec 状态 ──
  specPhase: SpecPhase | null;
  specFiles: Map<string, SpecFileState>;
  specTasks: SpecTaskState[];
  proposalContent: string | null;

  // ── 邀请码 ──
  activeInvite: RoomInvite | null;

  // ── Actions ──
  handleClawEvent: (event: ClawEvent) => void;
  setCurrentRoom: (roomId: string, name: string) => void;
  clearRoom: () => void;
}

export const useRoomStore = create<RoomStore>((set, get) => ({
  currentRoomId: null,
  currentRoomName: null,
  rooms: [],
  claws: new Map(),
  specPhase: null,
  specFiles: new Map(),
  specTasks: [],
  proposalContent: null,
  activeInvite: null,

  setCurrentRoom: (roomId, name) => set({ currentRoomId: roomId, currentRoomName: name }),

  clearRoom: () => set({
    currentRoomId: null,
    currentRoomName: null,
    claws: new Map(),
    specPhase: null,
    specFiles: new Map(),
    specTasks: [],
    proposalContent: null,
    activeInvite: null,
  }),

  handleClawEvent: (event) => {
    switch (event.type) {
      // ── Room 列表 ──
      case "ROOM_LIST": {
        set({ rooms: event.rooms });
        break;
      }
      case "ROOM_CREATED": {
        const { rooms } = get();
        set({
          rooms: [...rooms, {
            roomId: event.roomId,
            name: event.name,
            owner: event.owner,
            clawCount: 0,
            specPhase: null,
            createdAt: Date.now(),
          }],
        });
        break;
      }

      // ── Claw 连接 ──
      case "CLAW_JOINED": {
        const claws = new Map(get().claws);
        claws.set(event.clawId, {
          clawId: event.clawId,
          name: event.name,
          owner: event.owner,
          backend: event.backend,
          capabilities: event.capabilities,
          role: event.role,
          status: "idle",
          isLocal: event.isLocal,
          roomId: event.roomId,
          palette: event.palette,
          connectedAt: Date.now(),
        });
        set({ claws });
        break;
      }
      case "CLAW_LEFT": {
        const claws = new Map(get().claws);
        claws.delete(event.clawId);
        set({ claws });
        break;
      }
      case "CLAW_STATUS": {
        const claws = new Map(get().claws);
        const claw = claws.get(event.clawId);
        if (claw) {
          claws.set(event.clawId, { ...claw, status: event.status });
          set({ claws });
        }
        break;
      }
      case "CLAW_ROLE_CHANGED": {
        const claws = new Map(get().claws);
        const claw = claws.get(event.clawId);
        if (claw) {
          claws.set(event.clawId, { ...claw, role: event.role });
          set({ claws });
        }
        break;
      }

      // ── 邀请 ──
      case "INVITE_CREATED": {
        set({ activeInvite: event.invite });
        break;
      }

      // ── OpenSpec 工作流 ──
      case "SPEC_PHASE_CHANGED": {
        set({ specPhase: event.phase });
        break;
      }
      case "SPEC_FILE_UPDATED": {
        const specFiles = new Map(get().specFiles);
        specFiles.set(event.file, {
          path: event.file,
          content: event.content,
          updatedAt: Date.now(),
          updatedBy: event.updatedBy,
        });
        set({ specFiles });
        break;
      }
      case "SPEC_PROPOSAL_READY": {
        set({ proposalContent: event.proposal });
        break;
      }
      case "SPEC_PLAN_READY": {
        const specFiles = new Map(get().specFiles);
        for (const file of event.files) {
          specFiles.set(file.path, {
            path: file.path,
            content: file.content,
            updatedAt: Date.now(),
          });
        }
        set({ specFiles });
        break;
      }

      // ── 任务 ──
      case "SPEC_TASK_ASSIGNED": {
        const tasks = get().specTasks.map(t =>
          t.taskId === event.taskId
            ? { ...t, assignee: event.clawId, status: "assigned" }
            : t
        );
        set({ specTasks: tasks });
        break;
      }
      case "SPEC_TASK_PROGRESS": {
        const tasks = get().specTasks.map(t =>
          t.taskId === event.taskId
            ? { ...t, status: event.status }
            : t
        );
        set({ specTasks: tasks });
        break;
      }
      case "SPEC_TASKS_UPDATED": {
        set({
          specTasks: event.tasks.map(t => ({
            taskId: t.taskId,
            description: t.description,
            status: t.status,
            assignee: t.assignee,
          })),
        });
        break;
      }

      // ── 聊天 ──
      case "ROOM_CHAT": {
        // TODO: 转发给 office-store 的 teamMessages
        break;
      }
    }
  },
}));
