"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, LoaderCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { randomOpaqueToken, sha256Hex } from "@/lib/auth/crypto";
import { useRouter } from "next/navigation";
import {
  CONFIRMATION_INSTRUCTION,
  formatConfirmationCode,
  RATE_LIMITED_MESSAGE,
  challengeView,
  pollDelayMs,
  shouldKeepPolling,
  type ChallengeStatus,
} from "@/lib/auth/login-states";

type LoginState = "idle" | "starting" | "waiting" | "completing" | "error" | "rate-limited";

const STORAGE_PREFIX = "content-os-login:";

class LoginRequestError extends Error {
  constructor(readonly status: number, readonly reason: string | null, message: string) {
    super(message);
    this.name = "LoginRequestError";
  }
}

const messageFor = (status: ChallengeStatus) => challengeView(status).message;

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store", credentials: "same-origin" });
  const body = await response.json().catch(() => null) as ({ error?: string; reason?: string; retryAfterSeconds?: number } & T) | null;
  if (response.status === 429) throw new LoginRequestError(429, String(body?.retryAfterSeconds ?? 60), RATE_LIMITED_MESSAGE);
  if (!response.ok) throw new LoginRequestError(response.status, body?.reason ?? null, body?.error ?? "Kirish xizmati javob bermadi.");
  if (!body) throw new Error("Kirish xizmati noto‘g‘ri javob qaytardi.");
  return body;
}

export function TelegramLogin() {
  const router = useRouter();
  const [state, setState] = useState<LoginState>("idle");
  const [message, setMessage] = useState("Faqat Task Bot’da tasdiqlangan faol xodimlar kira oladi.");
  const [telegramLink, setTelegramLink] = useState<string | null>(null);
  const [confirmationCode, setConfirmationCode] = useState<string | null>(null);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const cancelled = useRef(false);

  useEffect(() => () => { cancelled.current = true; }, []);

  async function complete(challengeId: string, verifier: string) {
    setState("completing");
    setMessage(messageFor("APPROVED"));
    await jsonRequest("/api/auth/telegram/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challengeId, verifier }),
    });
    sessionStorage.removeItem(`${STORAGE_PREFIX}${challengeId}`);
    router.replace("/");
    router.refresh();
  }

  async function poll(challengeId: string, verifier: string, expiresAt: string) {
    const startedAt = Date.now();
    let attempt = 0;
    while (!cancelled.current && shouldKeepPolling(Date.now(), startedAt, expiresAt)) {
      const delay = pollDelayMs(attempt);
      await new Promise((resolve) => window.setTimeout(resolve, delay));
      if (cancelled.current) return;
      try {
        const result = await jsonRequest<{ status: ChallengeStatus; expiresAt: string | null }>(
          `/api/auth/telegram/status?challengeId=${encodeURIComponent(challengeId)}`,
        );
        if (result.status === "APPROVED") {
          try {
            await complete(challengeId, verifier);
          } catch (error) {
            if (error instanceof LoginRequestError && error.status !== 503) {
              sessionStorage.removeItem(`${STORAGE_PREFIX}${challengeId}`);
              setState("error");
              setMessage(error.reason === "USER_INACTIVE"
                ? "Kirish tasdiqlanmadi. Task Bot administratori bilan bog‘laning."
                : error.reason === "INVALID_PROOF"
                  ? "Kirish isboti mos kelmadi. Qaytadan boshlang."
                  : "Bu kirish so‘rovi yakunlangan. Qaytadan boshlang.");
              return;
            }
            throw error;
          }
          return;
        }
        if (challengeView(result.status).terminal) {
          sessionStorage.removeItem(`${STORAGE_PREFIX}${challengeId}`);
          setConfirmationCode(null);
          setState("error");
          setMessage(messageFor(result.status));
          return;
        }
        setMessage(messageFor("PENDING"));
      } catch {
        setMessage("Tarmoq uzildi. Xavfsiz tarzda qayta tekshirilmoqda…");
      }
      attempt += 1;
    }
    sessionStorage.removeItem(`${STORAGE_PREFIX}${challengeId}`);
    if (!cancelled.current) {
      setConfirmationCode(null);
      setState("error");
      setMessage("Tasdiqlash vaqti tugadi. Bot ochilmagan bo‘lsa, qaytadan urinib ko‘ring.");
    }
  }

  async function begin() {
    // Always a NEW challenge: fresh verifier, fresh code. A finished challenge is never resumed.
    if (Date.now() < cooldownUntil) return;
    cancelled.current = false;
    setState("starting");
    setMessage("Xavfsiz kirish so‘rovi yaratilmoqda…");
    setTelegramLink(null);
    setConfirmationCode(null);
    setPopupBlocked(false);
    try {
      const verifier = randomOpaqueToken(32);
      const verifierHash = await sha256Hex(verifier);
      const result = await jsonRequest<{ challengeId: string; telegramDeepLink: string; expiresAt: string; confirmationCode: string }>(
        "/api/auth/telegram/start",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ verifierHash }),
        },
      );
      sessionStorage.setItem(`${STORAGE_PREFIX}${result.challengeId}`, verifier);
      setTelegramLink(result.telegramDeepLink);
      setConfirmationCode(result.confirmationCode);
      setState("waiting");
      setMessage(messageFor("PENDING"));
      const opened = window.open(result.telegramDeepLink, "_blank", "noopener,noreferrer");
      // With noopener most browsers return null even on success, so the explicit link is always shown;
      // a blocked popup just makes it the primary path.
      setPopupBlocked(opened === null);
      await poll(result.challengeId, verifier, result.expiresAt);
    } catch (error) {
      if (error instanceof LoginRequestError && error.status === 429) {
        // Neutral, no internals, and no automatic retry: the button unlocks after the cooldown.
        const seconds = Math.min(Math.max(Number(error.reason) || 60, 10), 300);
        setCooldownUntil(Date.now() + seconds * 1000);
        window.setTimeout(() => setState((current) => (current === "rate-limited" ? "idle" : current)), seconds * 1000);
        setState("rate-limited");
        setMessage(RATE_LIMITED_MESSAGE);
        return;
      }
      setState("error");
      setMessage(error instanceof Error ? error.message : "Kirishni boshlash imkoni bo‘lmadi.");
    }
  }

  const busy = state === "starting" || state === "waiting" || state === "completing" || state === "rate-limited";
  return (
    <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,.14)] sm:p-8">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-700"><ShieldCheck className="size-6" /></div>
      <p className="mt-6 text-xs font-bold uppercase tracking-[0.16em] text-blue-700">IBOX Content OS</p>
      <h1 className="mt-2 text-3xl font-bold tracking-[-0.04em] text-slate-950">Xavfsiz kirish</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">Mavjud Telegram Task Bot orqali shaxsingizni tasdiqlang. Parol yoki Telegram ma’lumoti brauzerda saqlanmaydi.</p>
      <Button type="button" size="lg" className="mt-7 h-12 w-full rounded-xl" disabled={busy} onClick={begin}>
        {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
        {state === "error" ? "Qaytadan boshlash" : "Telegram orqali kirish"}
      </Button>
      {confirmationCode && (state === "waiting" || state === "completing") ? (
        <div className="mt-5 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-4 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-700">Tasdiqlash kodi</p>
          <p className="mt-1 font-mono text-3xl font-bold tracking-[0.12em] text-slate-950" data-testid="login-confirmation-code">Kod: {formatConfirmationCode(confirmationCode)}</p>
          <p className="mt-2 text-sm leading-5 text-slate-700">{CONFIRMATION_INSTRUCTION}</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">Kod mos kelmasa yoki bu so‘rovni siz boshlamagan bo‘lsangiz, Telegram’da “Bekor qilish”ni bosing.</p>
        </div>
      ) : null}
      {telegramLink && state === "waiting" ? (
        <a className={`mt-3 flex h-11 items-center justify-center gap-2 rounded-xl border text-sm font-semibold transition ${popupBlocked ? "border-blue-600 bg-blue-600 text-white hover:bg-blue-700" : "border-slate-200 text-slate-700 hover:border-blue-300 hover:bg-blue-50"}`} href={telegramLink} target="_blank" rel="noreferrer">
          {popupBlocked ? "Telegram’ni ochish" : "Botni qayta ochish"} <ExternalLink className="size-4" />
        </a>
      ) : null}
      <div role="status" aria-live="polite" className={`mt-5 rounded-xl px-4 py-3 text-sm leading-5 ${state === "error" ? "bg-rose-50 text-rose-700" : state === "rate-limited" ? "bg-amber-50 text-amber-800" : "bg-slate-50 text-slate-600"}`}>{message}</div>
    </div>
  );
}
