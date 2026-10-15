"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, LoaderCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { randomOpaqueToken, sha256Hex } from "@/lib/auth/crypto";
import { useRouter } from "next/navigation";

type LoginState = "idle" | "starting" | "waiting" | "completing" | "error";
type ChallengeStatus = "PENDING" | "APPROVED" | "CONSUMED" | "CANCELLED" | "EXPIRED" | "UNAVAILABLE";

const MAX_POLL_DURATION_MS = 10 * 60 * 1000;
const STORAGE_PREFIX = "content-os-login:";

class LoginRequestError extends Error {
  constructor(readonly status: number, readonly reason: string | null, message: string) {
    super(message);
    this.name = "LoginRequestError";
  }
}

function messageFor(status: ChallengeStatus): string {
  switch (status) {
    case "PENDING": return "Telegram botdagi tasdiqlash tugmasini bosing.";
    case "APPROVED": return "Tasdiqlandi. Xavfsiz sessiya yaratilmoqda…";
    case "CONSUMED": return "Bu kirish so‘rovi allaqachon ishlatilgan. Qaytadan boshlang.";
    case "CANCELLED": return "Kirish Telegram orqali bekor qilindi.";
    case "EXPIRED": return "Kirish so‘rovining muddati tugadi. Qaytadan urinib ko‘ring.";
    case "UNAVAILABLE": return "Kirish so‘rovi mavjud emas yoki yakunlangan.";
  }
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store", credentials: "same-origin" });
  const body = await response.json().catch(() => null) as ({ error?: string; reason?: string } & T) | null;
  if (!response.ok) throw new LoginRequestError(response.status, body?.reason ?? null, body?.error ?? "Kirish xizmati javob bermadi.");
  if (!body) throw new Error("Kirish xizmati noto‘g‘ri javob qaytardi.");
  return body;
}

export function TelegramLogin() {
  const router = useRouter();
  const [state, setState] = useState<LoginState>("idle");
  const [message, setMessage] = useState("Faqat Task Bot’da tasdiqlangan faol xodimlar kira oladi.");
  const [telegramLink, setTelegramLink] = useState<string | null>(null);
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
    while (!cancelled.current && Date.now() - startedAt < MAX_POLL_DURATION_MS && Date.now() < Date.parse(expiresAt)) {
      const delay = Math.min(1_500 * 1.35 ** attempt, 8_000);
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
        if (result.status !== "PENDING") {
          sessionStorage.removeItem(`${STORAGE_PREFIX}${challengeId}`);
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
      setState("error");
      setMessage("Tasdiqlash vaqti tugadi. Bot ochilmagan bo‘lsa, qaytadan urinib ko‘ring.");
    }
  }

  async function begin() {
    cancelled.current = false;
    setState("starting");
    setMessage("Xavfsiz kirish so‘rovi yaratilmoqda…");
    setTelegramLink(null);
    try {
      const verifier = randomOpaqueToken(32);
      const verifierHash = await sha256Hex(verifier);
      const result = await jsonRequest<{ challengeId: string; telegramDeepLink: string; expiresAt: string }>(
        "/api/auth/telegram/start",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ verifierHash }),
        },
      );
      sessionStorage.setItem(`${STORAGE_PREFIX}${result.challengeId}`, verifier);
      setTelegramLink(result.telegramDeepLink);
      setState("waiting");
      setMessage(messageFor("PENDING"));
      window.open(result.telegramDeepLink, "_blank", "noopener,noreferrer");
      await poll(result.challengeId, verifier, result.expiresAt);
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Kirishni boshlash imkoni bo‘lmadi.");
    }
  }

  const busy = state === "starting" || state === "waiting" || state === "completing";
  return (
    <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,.14)] sm:p-8">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-700"><ShieldCheck className="size-6" /></div>
      <p className="mt-6 text-xs font-bold uppercase tracking-[0.16em] text-blue-700">IBOX Content OS</p>
      <h1 className="mt-2 text-3xl font-bold tracking-[-0.04em] text-slate-950">Xavfsiz kirish</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">Mavjud Telegram Task Bot orqali shaxsingizni tasdiqlang. Parol yoki Telegram ma’lumoti brauzerda saqlanmaydi.</p>
      <Button type="button" size="lg" className="mt-7 h-12 w-full rounded-xl" disabled={busy} onClick={begin}>
        {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
        Telegram orqali kirish
      </Button>
      {telegramLink && state === "waiting" ? (
        <a className="mt-3 flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 transition hover:border-blue-300 hover:bg-blue-50" href={telegramLink} target="_blank" rel="noreferrer">
          Botni qayta ochish <ExternalLink className="size-4" />
        </a>
      ) : null}
      <div role="status" aria-live="polite" className={`mt-5 rounded-xl px-4 py-3 text-sm leading-5 ${state === "error" ? "bg-rose-50 text-rose-700" : "bg-slate-50 text-slate-600"}`}>{message}</div>
    </div>
  );
}
