/**
 * claw-event-bridge.ts — 将 Gateway WS 事件分流到 room-store
 *
 * 接入点: ws-client.ts 的 onmessage 中，在 handleEvent 之后调用。
 * 只转发 Claw/Room/Spec 相关事件，其他事件忽略。
 */
import { useRoomStore } from "@/store/room-store";
import type { ClawEvent } from "@office/shared";

// 所有 Claw/Room/Spec 事件类型
const CLAW_EVENT_TYPES = new Set([
  "ROOM_CREATED",
  "ROOM_LIST",
  "CLAW_JOINED",
  "CLAW_LEFT",
  "CLAW_STATUS",
  "CLAW_ROLE_CHANGED",
  "INVITE_CREATED",
  "SPEC_PHASE_CHANGED",
  "SPEC_FILE_UPDATED",
  "SPEC_PROPOSAL_READY",
  "SPEC_PLAN_READY",
  "SPEC_TASK_ASSIGNED",
  "SPEC_TASK_PROGRESS",
  "SPEC_TASKS_UPDATED",
  "ROOM_CHAT",
]);

/**
 * 调用此函数将事件转发给 room-store。
 * 只处理 Claw/Room/Spec 相关事件，其他事件跳过。
 */
export function bridgeClawEvent(event: Record<string, unknown>): void {
  if (!event.type || !CLAW_EVENT_TYPES.has(event.type as string)) return;

  try {
    useRoomStore.getState().handleClawEvent(event as unknown as ClawEvent);
  } catch (err) {
    console.error("[ClawBridge] Failed to handle event:", event.type, err);
  }
}
