import type { AuthenticatedUser } from "./auth/repository";
import type { TaskBackendTask } from "./task-client-types";

export function isHead(user: Pick<AuthenticatedUser, "role">): boolean {
  return user.role === "HEAD_OF_MARKETING";
}

export function isTaskCreator(user: Pick<AuthenticatedUser, "id">, task: TaskBackendTask): boolean {
  return user.id === task.creatorId;
}

export function isTaskAssignee(user: Pick<AuthenticatedUser, "id">, task: TaskBackendTask): boolean {
  return user.id === task.assigneeId;
}

export function canEditTask(user: Pick<AuthenticatedUser, "id" | "role">, task: TaskBackendTask): boolean {
  return isHead(user) || isTaskCreator(user, task);
}

export function canDirectReassign(user: Pick<AuthenticatedUser, "id" | "role">, task: TaskBackendTask): boolean {
  return canEditTask(user, task) && task.status !== "DONE" && task.status !== "CANCELLED";
}

export const canDirectChangeDeadline = canDirectReassign;

export function canRequestTaskChange(user: Pick<AuthenticatedUser, "id" | "role">, task: TaskBackendTask): boolean {
  return isTaskAssignee(user, task)
    && !isTaskCreator(user, task)
    && !isHead(user)
    && task.status !== "DONE"
    && task.status !== "CANCELLED";
}

export function canArchiveTask(user: Pick<AuthenticatedUser, "role">): boolean {
  return isHead(user);
}

