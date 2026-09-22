declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    GOOGLE_SHEET_ID: string;
    GOOGLE_SERVICE_ACCOUNT_EMAIL: string;
    GOOGLE_PRIVATE_KEY: string;
    DATA_SOURCE?: string;
  }
}
