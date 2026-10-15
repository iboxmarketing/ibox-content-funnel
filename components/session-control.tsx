"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";

export function SessionControl({ displayName, role }: { displayName: string; role: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("logout failed");
      router.replace("/login");
      router.refresh();
    } catch {
      setBusy(false);
    }
  }

  return (
    <div className="group-data-[collapsible=icon]:hidden">
      <p className="truncate text-xs font-semibold text-white">{displayName}</p>
      <p className="mt-0.5 truncate text-[10px] text-blue-200/60">{role.replaceAll("_", " ")}</p>
      <button type="button" disabled={busy} onClick={logout} className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-blue-100/70 transition hover:text-white disabled:opacity-50">
        <LogOut className="size-3" /> {busy ? "Chiqilmoqda…" : "Chiqish"}
      </button>
    </div>
  );
}
