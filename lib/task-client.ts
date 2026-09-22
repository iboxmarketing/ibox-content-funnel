import { TaskBackendNotConfiguredError } from "./task-client-types";
import type { TaskBackendTask, TaskClient } from "./task-client-types";

/**
 * The only concrete TaskClient today. Every method fails the same way the
 * existing `PATCH /api/production/tasks` route already fails
 * (TASK_BACKEND_SETUP_REQUIRED) -- this class exists so that future callers
 * code against the TaskClient interface instead of against that route's
 * response shape, without changing what actually happens right now: no task
 * write reaches any backend from Content OS. Parameters are omitted (rather
 * than named-and-unused) since every method ignores its input and throws;
 * TypeScript still accepts this as a valid TaskClient implementation.
 */
export class BlockedTaskClient implements TaskClient {
  async create(): Promise<TaskBackendTask> {
    throw new TaskBackendNotConfiguredError();
  }

  async read(): Promise<TaskBackendTask | null> {
    throw new TaskBackendNotConfiguredError();
  }

  async accept(): Promise<TaskBackendTask> {
    throw new TaskBackendNotConfiguredError();
  }

  async transition(): Promise<TaskBackendTask> {
    throw new TaskBackendNotConfiguredError();
  }

  async requestDeadlineChange(): Promise<void> {
    throw new TaskBackendNotConfiguredError();
  }

  async submitForReview(): Promise<TaskBackendTask> {
    throw new TaskBackendNotConfiguredError();
  }

  async requestRevision(): Promise<TaskBackendTask> {
    throw new TaskBackendNotConfiguredError();
  }
}

export function getTaskClient(): TaskClient {
  return new BlockedTaskClient();
}
