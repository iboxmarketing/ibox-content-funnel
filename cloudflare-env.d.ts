declare namespace Cloudflare {
  interface Env {
    /** Preview/demo-only bindings retained for the isolated Sites fixtures. */
    DB?: D1Database;
    BUCKET?: R2Bucket;
    GOOGLE_SHEET_ID: string;
    GOOGLE_SERVICE_ACCOUNT_EMAIL: string;
    GOOGLE_PRIVATE_KEY: string;
    DATA_SOURCE?: string;
    CONTENT_OS_PERSISTENCE_ENABLED?: string;
    CONTENT_OS_SUPABASE_URL: string;
    CONTENT_OS_SUPABASE_SERVICE_ROLE_KEY: string;
    CONTENT_OS_TELEGRAM_BOT_USERNAME: string;
  }
}
