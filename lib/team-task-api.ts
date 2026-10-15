import { z } from "zod";
import type { SignedServiceTaskClient } from "./task-client-signed-service";

const uuid = z.string().uuid();
const isoDate = z.string().datetime({ offset: true });
const priority = z.enum(["high", "normal", "low"]);
const requestStatus = z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]);

export const TeamTaskMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), title: z.string().trim().min(1).max(200), description: z.string().max(5000).optional(), priority, assigneeId: uuid, deadline: isoDate }).strict(),
  z.object({ action: z.literal("edit"), taskId: uuid, title: z.string().trim().min(1).max(200), description: z.string().max(5000).nullable(), priority }).strict(),
  z.object({ action: z.literal("lifecycle"), taskId: uuid, taskAction: z.enum(["ACCEPT", "BLOCK", "RESUME", "SUBMIT_REVIEW", "APPROVE", "REQUEST_REVISION", "CANCEL", "REOPEN"]), reason: z.string().trim().min(1).max(2000).optional() }).strict(),
  z.object({ action: z.literal("direct-reassign"), taskId: uuid, assigneeId: uuid }).strict(),
  z.object({ action: z.literal("direct-deadline"), taskId: uuid, deadline: isoDate }).strict(),
  z.object({ action: z.literal("request-reassign"), taskId: uuid, requestedAssigneeId: uuid, reason: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ action: z.literal("request-deadline"), taskId: uuid, requestedDeadline: isoDate, reason: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ action: z.literal("resolve-reassign"), requestId: uuid, approve: z.boolean(), resolutionNote: z.string().trim().max(2000).optional() }).strict(),
  z.object({ action: z.literal("resolve-deadline"), requestId: uuid, approve: z.boolean(), resolutionNote: z.string().trim().max(2000).optional() }).strict(),
  z.object({ action: z.literal("archive"), taskId: uuid, reason: z.string().trim().min(1).max(2000).optional() }).strict(),
  z.object({ action: z.literal("restore"), taskId: uuid }).strict(),
]);

export type TeamTaskMutation = z.infer<typeof TeamTaskMutationSchema>;
export type TeamTaskClient = Pick<SignedServiceTaskClient,
  | "create"
  | "listTasks"
  | "getDetails"
  | "listUsers"
  | "listChangeRequests"
  | "editTask"
  | "action"
  | "directReassign"
  | "directDeadline"
  | "requestReassign"
  | "requestDeadline"
  | "resolveReassign"
  | "resolveDeadline"
  | "archive"
  | "restore"
>;

export async function readTeamTasks(
  params: URLSearchParams,
  client: TeamTaskClient,
): Promise<Record<string, unknown>> {
  const resource = z.enum(["tasks", "task", "users", "requests"]).parse(params.get("resource") ?? "tasks");
  if (resource === "tasks") {
    const scope = z.enum(["my", "all", "archived"]).parse(params.get("scope") ?? "all");
    return { tasks: await client.listTasks(scope) };
  }
  if (resource === "task") {
    return { details: await client.getDetails(uuid.parse(params.get("taskId"))) };
  }
  if (resource === "users") return { users: await client.listUsers() };
  const rawStatus = params.get("status");
  return { requests: await client.listChangeRequests(rawStatus ? requestStatus.parse(rawStatus) : undefined) };
}

export async function mutateTeamTask(
  body: unknown,
  actorId: string,
  client: TeamTaskClient,
): Promise<Record<string, unknown>> {
  const input = TeamTaskMutationSchema.parse(body);
  switch (input.action) {
    case "create":
      return {
        task: await client.create({
          title: input.title,
          ...(input.description ? { description: input.description } : {}),
          priority: input.priority,
          assigneeId: input.assigneeId,
          creatorId: actorId,
          deadline: input.deadline,
        }),
      };
    case "edit":
      return {
        task: await client.editTask(input.taskId, {
          title: input.title,
          description: input.description,
          priority: input.priority,
        }),
      };
    case "lifecycle":
      return { task: await client.action(input.taskId, input.taskAction, input.reason) };
    case "direct-reassign":
      return { task: await client.directReassign(input.taskId, input.assigneeId) };
    case "direct-deadline":
      return { task: await client.directDeadline(input.taskId, input.deadline) };
    case "request-reassign":
      return { reassignRequest: await client.requestReassign(input.taskId, input.requestedAssigneeId, input.reason) };
    case "request-deadline":
      return { deadlineRequest: await client.requestDeadline(input.taskId, input.requestedDeadline, input.reason) };
    case "resolve-reassign":
      return { reassignRequest: await client.resolveReassign(input.requestId, input.approve, input.resolutionNote) };
    case "resolve-deadline":
      return { deadlineRequest: await client.resolveDeadline(input.requestId, input.approve, input.resolutionNote) };
    case "archive":
      await client.archive(input.taskId, input.reason);
      return { archived: true };
    case "restore":
      return { task: await client.restore(input.taskId) };
  }
}
