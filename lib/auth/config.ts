import { assertSupabaseTarget, DeploymentTargetError } from "../deployment-target";

export type EnvLike = Readonly<Record<string, string | undefined>>;

export interface ContentOsAuthConfig {
  readonly supabaseUrl: string;
  readonly serviceRoleKey: string;
  readonly telegramBotUsername: string;
}

export const CONTENT_OS_AUTH_ENV = {
  supabaseUrl: "CONTENT_OS_SUPABASE_URL",
  serviceRoleKey: "CONTENT_OS_SUPABASE_SERVICE_ROLE_KEY",
  telegramBotUsername: "CONTENT_OS_TELEGRAM_BOT_USERNAME",
} as const;

export class ContentOsAuthConfigError extends Error {
  readonly code = "CONTENT_OS_AUTH_CONFIG_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "ContentOsAuthConfigError";
  }
}

export function resolveContentOsAuthConfig(env: EnvLike): ContentOsAuthConfig {
  const supabaseUrl = env[CONTENT_OS_AUTH_ENV.supabaseUrl]?.trim();
  const serviceRoleKey = env[CONTENT_OS_AUTH_ENV.serviceRoleKey]?.trim();
  const telegramBotUsername = env[CONTENT_OS_AUTH_ENV.telegramBotUsername]?.trim().replace(/^@/, "");
  const missing = [
    !supabaseUrl && CONTENT_OS_AUTH_ENV.supabaseUrl,
    !serviceRoleKey && CONTENT_OS_AUTH_ENV.serviceRoleKey,
    !telegramBotUsername && CONTENT_OS_AUTH_ENV.telegramBotUsername,
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new ContentOsAuthConfigError(`${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} missing.`);
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(supabaseUrl as string);
  } catch {
    throw new ContentOsAuthConfigError(`${CONTENT_OS_AUTH_ENV.supabaseUrl} must be a valid https:// URL.`);
  }
  if (parsedUrl.protocol !== "https:") {
    throw new ContentOsAuthConfigError(`${CONTENT_OS_AUTH_ENV.supabaseUrl} must be a valid https:// URL.`);
  }
  try {
    assertSupabaseTarget(env, parsedUrl.origin);
  } catch (error) {
    if (error instanceof DeploymentTargetError) throw new ContentOsAuthConfigError(error.message);
    throw error;
  }
  if (!/^[A-Za-z0-9_]{5,32}$/.test(telegramBotUsername as string)) {
    throw new ContentOsAuthConfigError(`${CONTENT_OS_AUTH_ENV.telegramBotUsername} is not a valid Telegram bot username.`);
  }

  return {
    supabaseUrl: parsedUrl.origin,
    serviceRoleKey: serviceRoleKey as string,
    telegramBotUsername: telegramBotUsername as string,
  };
}
