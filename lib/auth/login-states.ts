/**
 * Browser login state rules (pure; Sprint 10D). Every non-PENDING, non-APPROVED
 * status is terminal: polling stops, the verifier is discarded, and only an
 * explicit "start again" creates a NEW challenge (new verifier, new code).
 */
export type ChallengeStatus = "PENDING" | "APPROVED" | "CONSUMED" | "CANCELLED" | "EXPIRED" | "UNAVAILABLE";

export const CONFIRMATION_INSTRUCTION = "Telegram botdagi kod shu kod bilan bir xil bo‘lsa tasdiqlang.";
export const RATE_LIMITED_MESSAGE = "Juda ko‘p urinish bo‘ldi. Birozdan so‘ng qaytadan urinib ko‘ring.";
export const MAX_POLL_DURATION_MS = 10 * 60 * 1000;

export function challengeView(status: ChallengeStatus): { readonly terminal: boolean; readonly message: string } {
  switch (status) {
    case "PENDING": return { terminal: false, message: "Telegram botda kodni solishtiring va tasdiqlang." };
    case "APPROVED": return { terminal: false, message: "Tasdiqlandi. Xavfsiz sessiya yaratilmoqda…" };
    case "CONSUMED": return { terminal: true, message: "Bu kirish so‘rovi allaqachon ishlatilgan. Qaytadan boshlang." };
    case "CANCELLED": return { terminal: true, message: "Kirish Telegram orqali bekor qilindi." };
    case "EXPIRED": return { terminal: true, message: "Kirish so‘rovining muddati tugadi. Qaytadan urinib ko‘ring." };
    case "UNAVAILABLE": return { terminal: true, message: "Kirish so‘rovi mavjud emas yoki yakunlangan." };
  }
}

/** Bounded backoff: 1.5 s growing to 8 s; never beyond the challenge expiry or 10 minutes. */
export function pollDelayMs(attempt: number): number {
  return Math.min(1_500 * 1.35 ** attempt, 8_000);
}

export function shouldKeepPolling(now: number, startedAt: number, expiresAt: string): boolean {
  return now - startedAt < MAX_POLL_DURATION_MS && now < Date.parse(expiresAt);
}
