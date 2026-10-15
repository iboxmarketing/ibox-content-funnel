"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  Check,
  Clock3,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  UserRound,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { AuthenticatedUser } from "@/lib/auth/repository";
import type { LifecycleAction, TaskCapabilities, WorkflowAction } from "@/lib/team-task-policy";
import type {
  TaskBackendChangeRequests,
  TaskBackendDetails,
  TaskBackendPriority,
  TaskBackendStatus,
  TaskBackendTask,
  TaskBackendUser,
} from "@/lib/task-client-types";

type CurrentUser = Pick<AuthenticatedUser, "id" | "displayName" | "role">;
/** Every control below is driven by these server-computed capabilities, never by local role checks. */
type TaskWithCapabilities = TaskBackendTask & { readonly capabilities?: TaskCapabilities };
type TaskView = "my" | "all" | "requests" | "archived";

const EMPTY_REQUESTS: TaskBackendChangeRequests = { deadlineRequests: [], reassignRequests: [] };
const STATUS_TONE: Record<TaskBackendStatus, string> = {
  ASSIGNED: "border-slate-200 bg-slate-50 text-slate-700",
  IN_PROGRESS: "border-blue-200 bg-blue-50 text-blue-700",
  BLOCKED: "border-red-200 bg-red-50 text-red-700",
  REVIEW: "border-violet-200 bg-violet-50 text-violet-700",
  REVISION: "border-amber-200 bg-amber-50 text-amber-700",
  DONE: "border-emerald-200 bg-emerald-50 text-emerald-700",
  CANCELLED: "border-slate-200 bg-slate-100 text-slate-500",
};

function displayDate(value: string): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json() as T & { code?: string; error?: string };
  if (!response.ok) throw new Error(body.error || body.code || `Request failed (${response.status})`);
  return body;
}

function userName(users: readonly TaskBackendUser[], id: string | null): string {
  if (!id) return "—";
  return users.find((user) => user.id === id)?.displayName ?? id.slice(0, 8);
}

function nextDayLocalInput(): string {
  const value = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return localDateTimeInput(value);
}

function localDateTimeInput(value: Date): string {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

const LIFECYCLE_LABEL: Record<LifecycleAction, string> = {
  ACCEPT: "Accept", BLOCK: "Block", RESUME: "Resume", SUBMIT_REVIEW: "Submit review",
  APPROVE: "Approve", REQUEST_REVISION: "Request revision", CANCEL: "Cancel", REOPEN: "Reopen",
};

class ApiConflictError extends Error {}

async function workflowApi(body: Record<string, unknown>): Promise<void> {
  const response = await fetch("/api/content-os/blog-review", { method: "POST", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({})) as { code?: string; error?: string };
  if (response.status === 409) throw new ApiConflictError(result.error || "The task changed; the view has been refreshed.");
  if (!response.ok) throw new Error(result.error || result.code || `Request failed (${response.status})`);
}

function WorkflowPanel({ task, capabilities, users, busy, onWorkflow }: {
  task: TaskBackendTask;
  capabilities: TaskCapabilities;
  users: readonly TaskBackendUser[];
  busy: boolean;
  onWorkflow: (body: Record<string, unknown>) => Promise<void>;
}) {
  const classification = capabilities.classification;
  const reviewers = users.filter((user) => user.isActive && user.id !== task.assigneeId && !capabilities.forbiddenAssigneeIds.includes(user.id));
  const [reviewerId, setReviewerId] = useState(reviewers[0]?.id ?? "");
  const [reviewDeadline, setReviewDeadline] = useState(nextDayLocalInput);
  const [note, setNote] = useState("");
  if (classification.kind !== "CONTENT_OS") return null;
  const has = (action: WorkflowAction) => capabilities.workflowActions.includes(action);
  const firstCompletion = classification.code === "BLOG" && !classification.reviewerId;
  return <div className="rounded-2xl border border-violet-200 bg-violet-50/40 p-4">
    <h3 className="text-sm font-bold text-slate-900">Content OS workflow · {classification.code}</h3>
    <p className="mt-1 text-xs text-slate-600">This task moves only through the Blog review workflow. Generic creator and lifecycle controls do not apply.</p>
    {has("COMPLETE_BLOG") ? <div className="mt-3 space-y-2">
      {firstCompletion ? <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-600">Head Review reviewer<select value={reviewerId} onChange={(event) => setReviewerId(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm">{reviewers.map((user) => <option key={user.id} value={user.id}>{user.displayName}</option>)}</select></label><label className="text-xs font-semibold text-slate-600">Review deadline<Input type="datetime-local" value={reviewDeadline} onChange={(event) => setReviewDeadline(event.target.value)} className="mt-1 bg-white" /></label></div> : null}
      <Button size="sm" disabled={busy || (firstCompletion && !reviewerId)} onClick={() => void onWorkflow({ action: "complete", blogTaskId: task.id, reviewerId: firstCompletion ? reviewerId : (classification.reviewerId ?? reviewerId), reviewDeadline: new Date(reviewDeadline).toISOString() })}><Check className="size-4" /> {task.status === "REVISION" ? "Resubmit Blog for review" : "Complete Blog & open Head Review"}</Button>
    </div> : null}
    {has("REVIEW_REQUEST_REVISION") || has("REVIEW_APPROVE") ? <div className="mt-3 space-y-2">
      {has("REVIEW_REQUEST_REVISION") ? <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="What must the author change?" className="bg-white" /> : null}
      <div className="flex flex-wrap gap-2">
        {has("REVIEW_APPROVE") ? <Button size="sm" disabled={busy} onClick={() => void onWorkflow({ action: "approve", reviewTaskId: task.id })}><Check className="size-4" /> Approve Blog</Button> : null}
        {has("REVIEW_REQUEST_REVISION") ? <Button size="sm" variant="outline" disabled={busy || !note.trim()} onClick={() => void onWorkflow({ action: "request-revision", reviewTaskId: task.id, note: note.trim() })}>Request revision</Button> : null}
      </div>
    </div> : null}
    {!capabilities.workflowActions.length ? <p className="mt-2 text-xs text-slate-500">No workflow action is available to you on this task right now.</p> : null}
  </div>;
}

function CreateTaskPanel({ users, currentUser, onCreated }: {
  users: readonly TaskBackendUser[];
  currentUser: CurrentUser;
  onCreated: () => Promise<void>;
}) {
  const activeUsers = users.filter((user) => user.isActive);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskBackendPriority>("normal");
  const [assigneeId, setAssigneeId] = useState(currentUser.id);
  const [deadline, setDeadline] = useState(nextDayLocalInput);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await api("/api/team/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "create", title, description: description || undefined, priority, assigneeId, deadline: new Date(deadline).toISOString() }),
      });
      setTitle("");
      setDescription("");
      setOpen(false);
      await onCreated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Task could not be created.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return <Button onClick={() => setOpen(true)} className="bg-blue-700 hover:bg-blue-800"><Plus className="size-4" /> Create task</Button>;
  return (
    <div className="w-full rounded-2xl border border-blue-200 bg-blue-50/50 p-4">
      <div className="flex items-center justify-between"><h2 className="font-bold text-slate-950">New team task</h2><Button size="icon" variant="ghost" onClick={() => setOpen(false)} aria-label="Close"><X className="size-4" /></Button></div>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <label className="text-xs font-semibold text-slate-600">Title<Input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 bg-white" /></label>
        <label className="text-xs font-semibold text-slate-600">Assignee<select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm">{activeUsers.map((user) => <option key={user.id} value={user.id}>{user.displayName} · {user.role}</option>)}</select></label>
        <label className="text-xs font-semibold text-slate-600">Deadline<Input type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)} className="mt-1 bg-white" /></label>
        <label className="text-xs font-semibold text-slate-600">Priority<select value={priority} onChange={(event) => setPriority(event.target.value as TaskBackendPriority)} className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select></label>
      </div>
      <label className="mt-3 block text-xs font-semibold text-slate-600">Context<Textarea value={description} onChange={(event) => setDescription(event.target.value)} className="mt-1 bg-white" /></label>
      {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}
      <Button className="mt-3 bg-blue-700 hover:bg-blue-800" disabled={saving || !title.trim() || !assigneeId || !deadline} onClick={() => void submit()}>{saving ? <RefreshCw className="size-4 animate-spin" /> : <Send className="size-4" />} Create through Task Bot</Button>
    </div>
  );
}

function RequestsPanel({ requests, tasks, users, busy, onResolve }: {
  requests: TaskBackendChangeRequests;
  tasks: readonly TaskBackendTask[];
  users: readonly TaskBackendUser[];
  busy: boolean;
  onResolve: (action: "resolve-deadline" | "resolve-reassign", requestId: string, approve: boolean) => Promise<void>;
}) {
  const title = (taskId: string) => tasks.find((task) => task.id === taskId)?.title ?? taskId.slice(0, 8);
  const rows = [
    ...requests.deadlineRequests.map((request) => ({ kind: "deadline" as const, id: request.id, taskId: request.taskId, status: request.status, requestedBy: request.requestedBy, reason: request.reason, change: displayDate(request.requestedDeadline), createdAt: request.createdAt })),
    ...requests.reassignRequests.map((request) => ({ kind: "reassign" as const, id: request.id, taskId: request.taskId, status: request.status, requestedBy: request.requestedBy, reason: request.reason, change: userName(users, request.requestedAssigneeId), createdAt: request.createdAt })),
  ].toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
  if (!rows.length) return <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">No change requests.</div>;
  return <div className="space-y-3">{rows.map((row) => <div key={`${row.kind}-${row.id}`} className="rounded-2xl border border-slate-200 bg-white p-4">
    <div className="flex flex-wrap items-start gap-2"><div className="min-w-0 flex-1"><p className="text-sm font-bold text-slate-950">{title(row.taskId)}</p><p className="mt-1 text-xs text-slate-500">{row.kind === "deadline" ? "Deadline" : "Reassign"} requested by {userName(users, row.requestedBy)} → <strong className="text-slate-800">{row.change}</strong></p><p className="mt-2 text-xs text-slate-600">{row.reason}</p></div><Badge variant="outline" className={row.status === "PENDING" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-slate-200"}>{row.status}</Badge></div>
    {row.status === "PENDING" ? <div className="mt-3 flex gap-2"><Button size="sm" disabled={busy} onClick={() => void onResolve(row.kind === "deadline" ? "resolve-deadline" : "resolve-reassign", row.id, true)}><Check className="size-4" /> Approve</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void onResolve(row.kind === "deadline" ? "resolve-deadline" : "resolve-reassign", row.id, false)}><X className="size-4" /> Reject</Button></div> : null}
  </div>)}</div>;
}

function TaskDetailPanel({ details, capabilities, users, busy, onMutation, onWorkflow }: {
  details: TaskBackendDetails;
  capabilities: TaskCapabilities;
  users: readonly TaskBackendUser[];
  busy: boolean;
  onMutation: (body: Record<string, unknown>) => Promise<void>;
  onWorkflow: (body: Record<string, unknown>) => Promise<void>;
}) {
  const task = details.task;
  const archived = details.archive !== null;
  const workflowTask = capabilities.classification.kind === "CONTENT_OS";
  const activeUsers = users.filter((user) => user.isActive && !capabilities.forbiddenAssigneeIds.includes(user.id));
  const direct = capabilities.canEdit;
  const request = capabilities.canRequestChange;
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [priority, setPriority] = useState(task.priority);
  const [assigneeId, setAssigneeId] = useState(task.assigneeId);
  const [deadline, setDeadline] = useState(() => localDateTimeInput(new Date(task.deadline)));
  const [reason, setReason] = useState("");

  const actions = capabilities.lifecycleActions.map((action) => ({ action, label: LIFECYCLE_LABEL[action] }));
  const requester = archived
    ? "Archived — workflow and task fields are read only until Head restores this task."
    : workflowTask && !direct && !request
      ? "Content OS workflow task — use the workflow actions below; generic creator controls do not apply."
      : request
      ? "Changes require Head approval."
      : direct
        ? "You can change this task directly."
        : "Read only for you.";
  return <div className="space-y-4">
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start gap-2"><div className="min-w-0 flex-1"><h2 className="text-lg font-bold text-slate-950">{task.title}</h2><p className="mt-1 text-xs text-slate-500">Creator: {userName(users, task.creatorId)} · Assignee: {userName(users, task.assigneeId)}</p></div><Badge variant="outline" className={STATUS_TONE[task.status]}>{task.status}</Badge></div>
      <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600">{task.description || "No additional context."}</p>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500"><span className="rounded-lg bg-slate-50 px-2 py-1">Priority: {task.priority}</span><span className="rounded-lg bg-slate-50 px-2 py-1">Deadline: {displayDate(task.deadline)}</span><span className="rounded-lg bg-slate-50 px-2 py-1">History: {details.events.length} events</span></div>
      <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{requester}</p>
    </div>

    <WorkflowPanel task={task} capabilities={capabilities} users={users} busy={busy || archived} onWorkflow={onWorkflow} />

    {actions.length ? <div className="rounded-2xl border border-slate-200 bg-white p-4"><h3 className="text-sm font-bold text-slate-900">Workflow</h3><Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason for block, revision, or cancellation" className="mt-2" /><div className="mt-3 flex flex-wrap gap-2">{actions.map((entry) => <Button key={entry.action} size="sm" variant={entry.action === "CANCEL" || entry.action === "REQUEST_REVISION" ? "outline" : "default"} disabled={busy || (["BLOCK", "REQUEST_REVISION", "CANCEL"].includes(entry.action) && !reason.trim())} onClick={() => void onMutation({ action: "lifecycle", taskId: task.id, taskAction: entry.action, ...(reason.trim() ? { reason: reason.trim() } : {}) })}>{entry.label}</Button>)}</div></div> : null}

    {direct ? <div className="rounded-2xl border border-slate-200 bg-white p-4"><h3 className="text-sm font-bold text-slate-900">{workflowTask ? "Head controls" : "Creator / Head controls"}</h3><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-600">Title<Input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1" /></label><label className="text-xs font-semibold text-slate-600">Priority<select value={priority} onChange={(event) => setPriority(event.target.value as TaskBackendPriority)} className="mt-1 h-9 w-full rounded-md border border-slate-200 px-3 text-sm"><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select></label></div><label className="mt-3 block text-xs font-semibold text-slate-600">Context<Textarea value={description} onChange={(event) => setDescription(event.target.value)} className="mt-1" /></label><Button size="sm" className="mt-3" disabled={busy || !title.trim()} onClick={() => void onMutation({ action: "edit", taskId: task.id, title, description: description || null, priority })}>Save content</Button>
      {capabilities.canDirectReassign || capabilities.canDirectDeadline ? <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2">{capabilities.canDirectReassign ? <label className="text-xs font-semibold text-slate-600">Direct assignee<select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-slate-200 px-3 text-sm">{activeUsers.map((user) => <option key={user.id} value={user.id}>{user.displayName}</option>)}</select><Button size="sm" variant="outline" className="mt-2" disabled={busy || assigneeId === task.assigneeId} onClick={() => void onMutation({ action: "direct-reassign", taskId: task.id, assigneeId })}>Reassign directly</Button></label> : null}{capabilities.canDirectDeadline ? <label className="text-xs font-semibold text-slate-600">Direct deadline<Input type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)} className="mt-1" /><Button size="sm" variant="outline" className="mt-2" disabled={busy} onClick={() => void onMutation({ action: "direct-deadline", taskId: task.id, deadline: new Date(deadline).toISOString() })}>Change directly</Button></label> : null}</div> : null}
    </div> : null}

    {request ? <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4"><h3 className="text-sm font-bold text-slate-900">Request a change</h3><Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why is this change needed?" className="mt-2 bg-white" /><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-600">Requested assignee<select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm">{activeUsers.map((user) => <option key={user.id} value={user.id}>{user.displayName}</option>)}</select><Button size="sm" className="mt-2" disabled={busy || !reason.trim() || assigneeId === task.assigneeId} onClick={() => void onMutation({ action: "request-reassign", taskId: task.id, requestedAssigneeId: assigneeId, reason: reason.trim() })}>Request reassign</Button></label><label className="text-xs font-semibold text-slate-600">Requested deadline<Input type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)} className="mt-1 bg-white" /><Button size="sm" className="mt-2" disabled={busy || !reason.trim()} onClick={() => void onMutation({ action: "request-deadline", taskId: task.id, requestedDeadline: new Date(deadline).toISOString(), reason: reason.trim() })}>Request deadline</Button></label></div></div> : null}

    {capabilities.canArchive || capabilities.canRestore ? <div className="rounded-2xl border border-slate-200 bg-white p-4">{details.archive ? <><p className="mb-2 text-xs text-slate-500">Archived {displayDate(details.archive.archivedAt)} by {userName(users, details.archive.archivedBy)}. Restoring preserves the same task id, status, and complete history. Change requests cancelled by the archive stay cancelled.</p><Button variant="outline" disabled={busy} onClick={() => void onMutation({ action: "restore", taskId: task.id })}><RotateCcw className="size-4" /> Restore same task</Button></> : <><p className="text-xs text-slate-500">“Delete” is a soft archive. Task identity, workflow status, Content OS links, and history are retained. Pending change requests are cancelled. The Task Bot refuses archiving an active Blog review pair.</p><Button variant="outline" className="mt-2 text-amber-700" disabled={busy} onClick={() => { if (window.confirm(`Archive “${task.title}”? This hides it from normal views, keeps its status and history, and cancels its pending change requests.`)) void onMutation({ action: "archive", taskId: task.id, ...(reason.trim() ? { reason: reason.trim() } : {}) }); }}><Archive className="size-4" /> Archive (soft delete)</Button></>}</div> : null}

    {details.deadlineRequests.length || details.reassignRequests.length ? <div className="rounded-2xl border border-slate-200 bg-white p-4"><h3 className="text-sm font-bold text-slate-900">Change requests</h3><div className="mt-3 space-y-2">{[
      ...details.deadlineRequests.map((entry) => ({ id: entry.id, label: "Deadline", value: displayDate(entry.requestedDeadline), status: entry.status, createdAt: entry.createdAt })),
      ...details.reassignRequests.map((entry) => ({ id: entry.id, label: "Reassign", value: userName(users, entry.requestedAssigneeId), status: entry.status, createdAt: entry.createdAt })),
    ].toSorted((left, right) => right.createdAt.localeCompare(left.createdAt)).map((entry) => <div key={entry.id} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2"><div className="min-w-0 flex-1"><p className="text-xs font-semibold text-slate-800">{entry.label} → {entry.value}</p><p className="text-[11px] text-slate-500">{displayDate(entry.createdAt)}</p></div><Badge variant="outline" className={entry.status === "PENDING" ? "border-amber-200 bg-amber-50 text-amber-700" : entry.status === "APPROVED" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-600"}>{entry.status}</Badge></div>)}</div></div> : null}

    <div className="rounded-2xl border border-slate-200 bg-white p-4"><h3 className="text-sm font-bold text-slate-900">History</h3><div className="mt-3 space-y-2">{[...details.events].reverse().slice(0, 20).map((event) => <div key={event.id} className="flex gap-3 rounded-xl bg-slate-50 px-3 py-2"><span className="mt-1 size-2 shrink-0 rounded-full bg-blue-500" /><div><p className="text-xs font-semibold text-slate-800">{event.eventType}</p><p className="text-[11px] text-slate-500">{displayDate(event.createdAt)} · {userName(users, event.actorId)}</p></div></div>)}</div></div>
  </div>;
}

export function TeamTaskManagement({ currentUser }: { currentUser: CurrentUser }) {
  const [view, setView] = useState<TaskView>("my");
  const [tasks, setTasks] = useState<readonly TaskWithCapabilities[]>([]);
  const [users, setUsers] = useState<readonly TaskBackendUser[]>([]);
  const [requests, setRequests] = useState<TaskBackendChangeRequests>(EMPTY_REQUESTS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [details, setDetails] = useState<TaskBackendDetails | null>(null);
  const [capabilities, setCapabilities] = useState<TaskCapabilities | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDetails = useCallback(async (taskId: string) => {
    const result = await api<{ details: TaskBackendDetails; capabilities: TaskCapabilities }>(`/api/team/tasks?resource=task&taskId=${encodeURIComponent(taskId)}`);
    setDetails(result.details);
    setCapabilities(result.capabilities);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const scope = view === "archived" ? "archived" : view === "my" ? "my" : "all";
      const [taskResult, userResult, requestResult] = await Promise.all([
        api<{ tasks: TaskWithCapabilities[] }>(`/api/team/tasks?resource=tasks&scope=${scope}`),
        api<{ users: TaskBackendUser[] }>("/api/team/tasks?resource=users"),
        view === "requests" ? api<{ requests: TaskBackendChangeRequests }>("/api/team/tasks?resource=requests") : Promise.resolve({ requests: EMPTY_REQUESTS }),
      ]);
      setTasks(taskResult.tasks);
      setUsers(userResult.users);
      setRequests(requestResult.requests);
      if (selectedId) {
        if (taskResult.tasks.some((task) => task.id === selectedId)) await loadDetails(selectedId);
        else { setSelectedId(null); setDetails(null); }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Task data could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [loadDetails, selectedId, view]);

  useEffect(() => {
    // Fetching the current backend snapshot is this effect's external synchronization.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  useEffect(() => {
    const interval = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(interval);
  }, [load]);

  /** Success = the Task Bot committed the mutation. Telegram delivery is the Task Bot's outbox, never a UI failure. */
  async function run(send: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await send();
      setNotice("Saved.");
    } catch (caught) {
      // A stale view (409) or refused action: show why, then re-read authoritative state.
      setError(caught instanceof Error ? caught.message : "Task action failed.");
    } finally {
      await load();
      if (selectedId) await loadDetails(selectedId).catch(() => { setSelectedId(null); setDetails(null); setCapabilities(null); });
      setBusy(false);
    }
  }
  const mutate = (body: Record<string, unknown>) => run(() => api("/api/team/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  const workflow = (body: Record<string, unknown>) => run(() => workflowApi(body));

  const userById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const tabs: Array<{ id: TaskView; label: string }> = [
    { id: "my", label: "My tasks" },
    { id: "all", label: "All tasks" },
    ...(currentUser.role === "HEAD_OF_MARKETING" ? [{ id: "requests" as const, label: "Requests" }, { id: "archived" as const, label: "Archived" }] : []),
  ];

  return <div className="flex h-full min-h-0 flex-col bg-[#F7F9FC]">
    <header className="shrink-0 border-b border-slate-200 bg-white px-4 py-4 lg:px-6"><div className="flex flex-wrap items-center gap-3"><div className="mr-auto"><h1 className="text-xl font-bold tracking-[-0.02em] text-slate-950">Team tasks</h1><p className="text-xs text-slate-500">One Task Bot record, one permission model, Telegram notifications included.</p></div><Button variant="outline" size="sm" disabled={loading} onClick={() => void load()}><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /> Refresh</Button><CreateTaskPanel users={users} currentUser={currentUser} onCreated={load} /></div><div className="mt-4 flex gap-1 overflow-x-auto">{tabs.map((tab) => <button key={tab.id} type="button" onClick={() => { setView(tab.id); setSelectedId(null); setDetails(null); }} className={`rounded-lg px-3 py-2 text-xs font-semibold ${view === tab.id ? "bg-blue-700 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{tab.label}</button>)}</div></header>
    {error ? <div className="shrink-0 border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{error}</div> : null}
    {notice && !error ? <div className="shrink-0 border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-700">{notice}</div> : null}
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <main className={`min-h-0 flex-1 overflow-y-auto p-4 lg:p-6 ${details ? "hidden xl:block xl:max-w-[52%]" : ""}`}>
        {view === "requests" ? <RequestsPanel requests={requests} tasks={tasks} users={users} busy={busy} onResolve={(action, requestId, approve) => mutate({ action, requestId, approve })} /> : loading && !tasks.length ? <div className="flex h-full items-center justify-center text-sm text-slate-500"><RefreshCw className="mr-2 size-4 animate-spin" /> Loading tasks…</div> : !tasks.length ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">No tasks in this view.</div> : <div className="grid gap-3 lg:grid-cols-2">{tasks.map((task) => <button key={task.id} type="button" onClick={() => { setSelectedId(task.id); setCapabilities(null); void loadDetails(task.id).catch((caught) => setError(caught instanceof Error ? caught.message : "Details failed.")); }} className={`rounded-2xl border bg-white p-4 text-left transition hover:border-blue-300 hover:shadow-sm ${selectedId === task.id ? "border-blue-400 ring-2 ring-blue-100" : "border-slate-200"}`}><div className="flex items-start gap-2"><div className="min-w-0 flex-1"><p className="line-clamp-2 text-sm font-bold text-slate-950">{task.title}</p><p className="mt-1 text-[11px] text-slate-500">{userById.get(task.assigneeId)?.displayName ?? task.assigneeId.slice(0, 8)}</p></div><div className="flex flex-col items-end gap-1"><Badge variant="outline" className={STATUS_TONE[task.status]}>{task.status}</Badge>{task.capabilities?.classification.kind === "CONTENT_OS" ? <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700">{task.capabilities.classification.code}</Badge> : null}</div></div><div className="mt-3 flex items-center gap-3 text-[11px] text-slate-500"><span className="flex items-center gap-1"><Clock3 className="size-3" /> {displayDate(task.deadline)}</span><span className="flex items-center gap-1"><UserRound className="size-3" /> {task.priority}</span></div></button>)}</div>}
      </main>
      {details ? <aside className="min-h-0 w-full overflow-y-auto border-l border-slate-200 bg-slate-50 p-4 xl:w-[48%] xl:p-6"><div className="mb-3 flex items-center justify-between"><p className="text-xs font-semibold text-slate-500">Task details</p><Button variant="ghost" size="sm" onClick={() => { setSelectedId(null); setDetails(null); setCapabilities(null); }}><X className="size-4" /> Close</Button></div>{capabilities ? <TaskDetailPanel key={`${details.task.id}:${details.task.updatedAt}:${details.archive?.archivedAt ?? "active"}`} details={details} capabilities={capabilities} users={users} busy={busy} onMutation={mutate} onWorkflow={workflow} /> : null}</aside> : null}
    </div>
  </div>;
}
