import { z } from "zod";
import type { SignedServiceTaskClient } from "./task-client-signed-service";
import type { TaskBackendTask } from "./task-client-types";
import { assertTaskMutationAllowed, computeTaskCapabilities, type PolicyActor, type PolicyMutation, type TaskCapabilities } from "./team-task-policy";
import type { WorkflowClassifier } from "./workflow-classifier";

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

export interface TeamTaskPolicyContext {
  readonly actor: PolicyActor;
  readonly classifier: WorkflowClassifier;
  /** Whether the Blog review workflow API is configured (workflow actions are offered only then). */
  readonly workflowApiEnabled: boolean;
}

async function capabilitiesFor(
  ctx: TeamTaskPolicyContext,
  entries: readonly { readonly task: TaskBackendTask; readonly archived: boolean }[],
): Promise<Map<string, TaskCapabilities>> {
  const classes = await ctx.classifier.classify(entries.map((entry) => entry.task.id));
  return new Map(entries.map(({ task, archived }) => [
    task.id,
    computeTaskCapabilities(ctx.actor, task, archived, classes.get(task.id) ?? { kind: "MANUAL" }, { workflowApiEnabled: ctx.workflowApiEnabled }),
  ]));
}

export async function readTeamTasks(
  params: URLSearchParams,
  client: TeamTaskClient,
  ctx: TeamTaskPolicyContext,
): Promise<Record<string, unknown>> {
  const resource = z.enum(["tasks", "task", "users", "requests"]).parse(params.get("resource") ?? "tasks");
  if (resource === "tasks") {
    const scope = z.enum(["my", "all", "archived"]).parse(params.get("scope") ?? "all");
    const tasks = await client.listTasks(scope);
    const capabilities = await capabilitiesFor(ctx, tasks.map((task) => ({ task, archived: scope === "archived" })));
    return { tasks: tasks.map((task) => ({ ...task, capabilities: capabilities.get(task.id) })) };
  }
  if (resource === "task") {
    const details = await client.getDetails(uuid.parse(params.get("taskId")));
    const capabilities = await capabilitiesFor(ctx, [{ task: details.task, archived: details.archive !== null }]);
    return { details, capabilities: capabilities.get(details.task.id) };
  }
  if (resource === "users") return { users: await client.listUsers() };
  const rawStatus = params.get("status");
  return { requests: await client.listChangeRequests(rawStatus ? requestStatus.parse(rawStatus) : undefined) };
}

/** Authoritative task state + provenance, re-read for every mutation (never trusted from the client). */
async function currentCapabilities(taskId: string, client: TeamTaskClient, ctx: TeamTaskPolicyContext): Promise<TaskCapabilities> {
  const details = await client.getDetails(taskId);
  const capabilities = await capabilitiesFor(ctx, [{ task: details.task, archived: details.archive !== null }]);
  return capabilities.get(details.task.id)!;
}

export async function mutateTeamTask(
  body: unknown,
  client: TeamTaskClient,
  ctx: TeamTaskPolicyContext,
): Promise<Record<string, unknown>> {
  const input = TeamTaskMutationSchema.parse(body);
  const check = async (taskId: string, mutation: PolicyMutation) => assertTaskMutationAllowed(await currentCapabilities(taskId, client, ctx), mutation);
  switch (input.action) {
    case "create":
      // Manual tasks only: Content OS workflow tasks are created by BlogReviewFlow.
      return {
        task: await client.create({
          title: input.title,
          ...(input.description ? { description: input.description } : {}),
          priority: input.priority,
          assigneeId: input.assigneeId,
          creatorId: ctx.actor.id,
          deadline: input.deadline,
        }),
      };
    case "edit":
      await check(input.taskId, { action: "edit" });
      return {
        task: await client.editTask(input.taskId, {
          title: input.title,
          description: input.description,
          priority: input.priority,
        }),
      };
    case "lifecycle":
      await check(input.taskId, { action: "lifecycle", taskAction: input.taskAction });
      return { task: await client.action(input.taskId, input.taskAction, input.reason) };
    case "direct-reassign":
      await check(input.taskId, { action: "direct-reassign", assigneeId: input.assigneeId });
      return { task: await client.directReassign(input.taskId, input.assigneeId) };
    case "direct-deadline":
      await check(input.taskId, { action: "direct-deadline" });
      return { task: await client.directDeadline(input.taskId, input.deadline) };
    case "request-reassign":
      await check(input.taskId, { action: "request-reassign", requestedAssigneeId: input.requestedAssigneeId });
      return { reassignRequest: await client.requestReassign(input.taskId, input.requestedAssigneeId, input.reason) };
    case "request-deadline":
      await check(input.taskId, { action: "request-deadline" });
      return { deadlineRequest: await client.requestDeadline(input.taskId, input.requestedDeadline, input.reason) };
    case "resolve-reassign": {
      if (input.approve) {
        // Head-only queue (the Task Bot refuses anyone else); the request's task and target are re-read here.
        const { reassignRequests } = await client.listChangeRequests("PENDING");
        const pending = reassignRequests.find((request) => request.id === input.requestId);
        if (pending) await check(pending.taskId, { action: "approve-reassign", requestedAssigneeId: pending.requestedAssigneeId });
      }
      return { reassignRequest: await client.resolveReassign(input.requestId, input.approve, input.resolutionNote) };
    }
    case "resolve-deadline":
      return { deadlineRequest: await client.resolveDeadline(input.requestId, input.approve, input.resolutionNote) };
    case "archive":
      await check(input.taskId, { action: "archive" });
      await client.archive(input.taskId, input.reason);
      return { archived: true };
    case "restore":
      await check(input.taskId, { action: "restore" });
      return { task: await client.restore(input.taskId) };
  }
}
