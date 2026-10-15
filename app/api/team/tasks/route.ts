import { ZodError } from "zod";
import { requireAuthenticatedUser } from "@/lib/auth/server";
import { readSameOriginJson } from "@/lib/auth/request-security";
import { mutateTeamTask, readTeamTasks, type TeamTaskPolicyContext } from "@/lib/team-task-api";
import { TaskPolicyError } from "@/lib/team-task-policy";
import { SupabaseWorkflowClassifier } from "@/lib/workflow-classifier";
import { PostgrestClient } from "@/lib/persistence/supabase-adapter";
import { resolveContentOsAuthConfig } from "@/lib/auth/config";
import { resolveContentOsPersistenceConfig } from "@/lib/persistence/config";
import type { AuthenticatedUser } from "@/lib/auth/repository";
import {
  getSignedServiceTaskClient,
  TaskBackendHttpError,
  TaskBackendServiceAuthConfigError,
  TaskBackendSignerInputError,
} from "@/lib/task-client-signed-service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStore = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };
const backendFetch = (input: string, init?: RequestInit) => fetch(input, {
  ...init,
  cache: "no-store",
  signal: AbortSignal.timeout(10_000),
});

function errorResponse(error: unknown): Response {
  if (error instanceof TaskPolicyError) {
    return Response.json({ code: error.code, error: error.message }, { status: error.status, headers: noStore });
  }
  if (error instanceof ZodError) {
    return Response.json({ code: "INVALID_INPUT", error: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") }, { status: 400, headers: noStore });
  }
  if (error instanceof TaskBackendHttpError) {
    return Response.json({ code: error.code, error: error.message }, { status: error.status, headers: noStore });
  }
  if (error instanceof TaskBackendServiceAuthConfigError || error instanceof TaskBackendSignerInputError) {
    return Response.json({ code: "TASK_BACKEND_NOT_CONFIGURED", error: "Task management is temporarily unavailable." }, { status: 503, headers: noStore });
  }
  console.error(JSON.stringify({
    event: "content_os.team_tasks",
    outcome: "backend_failure",
    errorName: error instanceof Error ? error.name : typeof error,
  }));
  return Response.json({ code: "TASK_BACKEND_UNAVAILABLE", error: "Task management is temporarily unavailable." }, { status: 503, headers: noStore });
}

/** Workflow provenance (content_task_runtime) is read server-side with the same service credentials as auth. */
function policyContext(user: AuthenticatedUser): TeamTaskPolicyContext {
  const config = resolveContentOsAuthConfig(process.env);
  const db = new PostgrestClient({ baseUrl: config.supabaseUrl, serviceRoleKey: config.serviceRoleKey, fetch: (url, init) => backendFetch(url, init) });
  let workflowApiEnabled = false;
  try {
    workflowApiEnabled = resolveContentOsPersistenceConfig(process.env) !== null;
  } catch {
    workflowApiEnabled = false;
  }
  return { actor: { id: user.id, role: user.role }, classifier: new SupabaseWorkflowClassifier(db), workflowApiEnabled };
}

function taskClient(actorId: string) {
  return getSignedServiceTaskClient(process.env, actorId, backendFetch);
}

export async function GET(request: Request) {
  const auth = await requireAuthenticatedUser(request);
  if (!auth.ok) return auth.response;
  try {
    const body = await readTeamTasks(new URL(request.url).searchParams, taskClient(auth.user.id), policyContext(auth.user));
    return Response.json(body, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireAuthenticatedUser(request);
  if (!auth.ok) return auth.response;
  const parsed = await readSameOriginJson(request);
  if (!parsed.ok) return parsed.response;
  try {
    const body = await mutateTeamTask(parsed.value, taskClient(auth.user.id), policyContext(auth.user));
    return Response.json(body, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}
