"use client";

import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc/client";
import { useOrgId } from "@/app/org/OrgContext";

export function NotificationBell() {
  const organizationId = useOrgId();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const count = trpc.notifications.unreadCount.useQuery(
    { organizationId },
    { refetchInterval: 60_000 },
  );
  const inbox = trpc.notifications.myInbox.useQuery(
    { organizationId, take: 20 },
    { enabled: open },
  );
  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: () => { void count.refetch(); void inbox.refetch(); },
  });
  const markAllRead = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => { void count.refetch(); void inbox.refetch(); },
  });

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const unread = count.data ?? 0;

  return (
    <div ref={ref} className="relative">
      <button
        className="relative flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted transition-colors"
        onClick={() => setOpen((o) => !o)}
        aria-label="Notificaciones"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-80 rounded-lg border bg-background shadow-lg">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <span className="text-sm font-semibold">Notificaciones</span>
            {unread > 0 && (
              <button
                className="text-xs text-muted-foreground hover:underline"
                onClick={() => markAllRead.mutate({ organizationId })}
              >
                Marcar todas leídas
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {inbox.isLoading && (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">Cargando...</p>
            )}
            {inbox.data?.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">Sin notificaciones</p>
            )}
            {inbox.data?.map((n) => (
              <div
                key={n.id}
                className={`flex cursor-pointer gap-3 border-b px-4 py-3 text-sm hover:bg-muted/30 ${!n.readAt ? "bg-blue-50 dark:bg-blue-950/20" : ""}`}
                onClick={() => { if (!n.readAt) markRead.mutate({ notificationId: n.id }); }}
              >
                <div className="mt-0.5 flex-shrink-0">
                  {!n.readAt && <span className="block h-2 w-2 rounded-full bg-blue-500" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 leading-snug">{n.body}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {n.sentAt ? new Date(n.sentAt).toLocaleString("es-VE") : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
