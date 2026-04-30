"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { useOrgId } from "../../../OrgContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const EVENT_LABELS: Record<string, string> = {
  INVOICE_ISSUED: "Factura emitida",
  PAYMENT_RECEIVED: "Pago recibido",
  PAYMENT_REMINDER: "Recordatorio de pago",
  OVERDUE_ALERT: "Alerta de mora",
  MAINTENANCE_ASSIGNED: "Mantenimiento asignado",
  MAINTENANCE_DONE: "Mantenimiento completado",
  ANNOUNCEMENT: "Aviso / Anuncio",
  ASSEMBLY_INVITE: "Convocatoria a asamblea",
};

const EVENT_HINTS: Record<string, string> = {
  INVOICE_ISSUED: "Variables: {nombre} {monto_usd} {monto_bs} {fecha_vence} {factura}",
  PAYMENT_RECEIVED: "Variables: {nombre} {monto_usd}",
  PAYMENT_REMINDER: "Variables: {nombre} {monto_usd}",
  OVERDUE_ALERT: "Variables: {nombre} {monto_usd}",
  MAINTENANCE_ASSIGNED: "Variables: {nombre} {titulo}",
  MAINTENANCE_DONE: "Variables: {nombre} {titulo}",
  ANNOUNCEMENT: "Variables: {titulo} {cuerpo}",
  ASSEMBLY_INVITE: "Variables: {nombre} {fecha} {lugar}",
};

export default function CommunicationPage() {
  const { id: communityId } = useParams<{ id: string }>();
  const organizationId = useOrgId();
  const [tab, setTab] = useState<"announcements" | "reminders" | "templates" | "history">("announcements");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 border-b pb-2">
        {(["announcements", "reminders", "templates", "history"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
          >
            {{ announcements: "Anuncios", reminders: "Recordatorios", templates: "Plantillas", history: "Historial" }[t]}
          </button>
        ))}
      </div>

      {tab === "announcements" && <AnnouncementsTab organizationId={organizationId} communityId={communityId} />}
      {tab === "reminders" && <RemindersTab organizationId={organizationId} communityId={communityId} />}
      {tab === "templates" && <TemplatesSection organizationId={organizationId} />}
      {tab === "history" && <HistoryTab organizationId={organizationId} communityId={communityId} />}
    </div>
  );
}

function TemplatesSection({ organizationId }: { organizationId: string }) {
  const [channel, setChannel] = useState<"whatsapp" | "email">("whatsapp");
  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b pb-3">
        <button
          onClick={() => setChannel("whatsapp")}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${channel === "whatsapp" ? "bg-green-600 text-white" : "text-muted-foreground hover:bg-muted"}`}
        >
          📱 WhatsApp
        </button>
        <button
          onClick={() => setChannel("email")}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${channel === "email" ? "bg-blue-600 text-white" : "text-muted-foreground hover:bg-muted"}`}
        >
          ✉️ Gmail / Email
        </button>
      </div>
      {channel === "whatsapp" && <TemplatesTab organizationId={organizationId} />}
      {channel === "email" && <EmailTemplatesTab organizationId={organizationId} />}
    </div>
  );
}

function AnnouncementsTab({ organizationId, communityId }: { organizationId: string; communityId: string }) {
  const list = trpc.notifications.announcements.list.useQuery({ organizationId, communityId });
  const create = trpc.notifications.announcements.create.useMutation({ onSuccess: () => void list.refetch() });
  const del = trpc.notifications.announcements.delete.useMutation({ onSuccess: () => void list.refetch() });
  const [form, setForm] = useState({ title: "", body: "", sendWhatsApp: false });
  const [showForm, setShowForm] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await create.mutateAsync({ organizationId, communityId, ...form });
    setForm({ title: "", body: "", sendWhatsApp: false });
    setShowForm(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Tablón de anuncios</h2>
        <Button onClick={() => setShowForm(true)}>+ Nuevo anuncio</Button>
      </div>

      {showForm && (
        <div className="rounded-lg border bg-card p-4">
          <form onSubmit={onSubmit} className="space-y-3">
            <div>
              <Label>Título</Label>
              <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required />
            </div>
            <div>
              <Label>Contenido</Label>
              <textarea
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                rows={4}
                value={form.body}
                onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                required
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.sendWhatsApp} onChange={(e) => setForm((f) => ({ ...f, sendWhatsApp: e.target.checked }))} />
              Enviar también por WhatsApp a todos los residentes
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button type="submit" disabled={create.isPending}>{create.isPending ? "Publicando..." : "Publicar"}</Button>
            </div>
          </form>
        </div>
      )}

      <div className="space-y-3">
        {list.data?.map((ann) => (
          <div key={ann.id} className="rounded-lg border bg-card p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-medium">{ann.title}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{ann.body}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {ann.publishedAt ? new Date(ann.publishedAt).toLocaleString("es-VE") : ""}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => del.mutate({ organizationId, announcementId: ann.id })}
              >
                Eliminar
              </Button>
            </div>
          </div>
        ))}
        {list.data?.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">No hay anuncios publicados</p>
        )}
      </div>
    </div>
  );
}

function RemindersTab({ organizationId, communityId }: { organizationId: string; communityId: string }) {
  const sendReminders = trpc.notifications.sendPaymentReminders.useMutation();
  const [result, setResult] = useState<{ sent: number } | null>(null);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Recordatorios de pago</h2>
      <div className="rounded-lg border bg-card p-6">
        <p className="text-sm text-muted-foreground mb-4">
          Envía un recordatorio de pago por WhatsApp a todos los propietarios que tengan facturas pendientes (EMITIDA, PARCIAL o VENCIDA).
        </p>
        <Button
          disabled={sendReminders.isPending}
          onClick={async () => {
            const r = await sendReminders.mutateAsync({ organizationId, communityId });
            setResult(r);
          }}
        >
          {sendReminders.isPending ? "Enviando..." : "Enviar recordatorios ahora"}
        </Button>
        {result && (
          <p className="mt-3 text-sm text-green-600">
            Recordatorios enviados a {result.sent} unidad(es) con saldo pendiente.
          </p>
        )}
      </div>
    </div>
  );
}

function TemplatesTab({ organizationId }: { organizationId: string }) {
  const list = trpc.notifications.templates.list.useQuery({ organizationId });
  const upsert = trpc.notifications.templates.upsert.useMutation({ onSuccess: () => void list.refetch() });
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const events = Object.keys(EVENT_LABELS) as (keyof typeof EVENT_LABELS)[];
  const templateMap = Object.fromEntries(list.data?.map((t) => [t.event, t.body]) ?? []);

  const startEdit = (event: string) => {
    setEditing(event);
    setDraft(templateMap[event] ?? "");
  };

  const save = async () => {
    if (!editing) return;
    await upsert.mutateAsync({ organizationId, event: editing as Parameters<typeof upsert.mutateAsync>[0]["event"], body: draft });
    setEditing(null);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Templates de WhatsApp</h2>
        <p className="text-sm text-muted-foreground">Personaliza los mensajes enviados automáticamente. Usa {"{variable}"} para datos dinámicos.</p>
      </div>

      <div className="space-y-3">
        {events.map((event) => (
          <div key={event} className="rounded-lg border bg-card p-4">
            {editing === event ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="font-medium">{EVENT_LABELS[event]}</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
                    <Button size="sm" onClick={save} disabled={upsert.isPending}>Guardar</Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{EVENT_HINTS[event]}</p>
                <textarea
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                  rows={4}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Escribe el template..."
                />
              </div>
            ) : (
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium">{EVENT_LABELS[event]}</p>
                  {templateMap[event] ? (
                    <p className="mt-1 text-sm text-muted-foreground line-clamp-2 font-mono">{templateMap[event]}</p>
                  ) : (
                    <p className="mt-1 text-xs italic text-muted-foreground">Usando mensaje por defecto del sistema</p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground/60">{EVENT_HINTS[event]}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => startEdit(event)}>
                  {templateMap[event] ? "Editar" : "Personalizar"}
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const EMAIL_DEFAULT_SUBJECTS: Record<string, string> = {
  INVOICE_ISSUED:       "Recibo de condominio - {comunidad} - {periodo}",
  PAYMENT_RECEIVED:     "Confirmación de pago recibido - {comunidad}",
  PAYMENT_REMINDER:     "Recordatorio de pago pendiente - {comunidad}",
  OVERDUE_ALERT:        "Aviso de mora - {comunidad}",
  MAINTENANCE_ASSIGNED: "Orden de mantenimiento asignada: {titulo}",
  MAINTENANCE_DONE:     "Orden de mantenimiento completada: {titulo}",
  ANNOUNCEMENT:         "Aviso de la comunidad: {titulo}",
  ASSEMBLY_INVITE:      "Convocatoria a asamblea - {fecha}",
};

const EMAIL_DEFAULT_BODIES: Record<string, string> = {
  INVOICE_ISSUED:       "Estimado/a {nombre},\n\nLe informamos que su recibo de condominio del período {periodo} por un monto de {monto_usd} USD ({monto_bs} Bs) ha sido emitido.\n\nFecha de vencimiento: {fecha_vence}\nN° de factura: {factura}\n\nPor favor realice su pago a tiempo.\n\nAtentamente,\nAdministración",
  PAYMENT_RECEIVED:     "Estimado/a {nombre},\n\nHemos recibido su pago de {monto_usd} USD correctamente. Gracias por mantenerse al día con sus obligaciones de condominio.\n\nAtentamente,\nAdministración",
  PAYMENT_REMINDER:     "Estimado/a {nombre},\n\nLe recordamos que tiene un saldo pendiente de {monto_usd} USD. Por favor realice su pago para evitar recargos.\n\nAtentamente,\nAdministración",
  OVERDUE_ALERT:        "Estimado/a {nombre},\n\nSu cuenta presenta un saldo en mora de {monto_usd} USD. Le solicitamos regularizar su situación a la brevedad posible.\n\nAtentamente,\nAdministración",
  MAINTENANCE_ASSIGNED: "Estimado/a {nombre},\n\nSu solicitud de mantenimiento \"{titulo}\" ha sido asignada a un técnico y está en proceso de atención.\n\nAtentamente,\nAdministración",
  MAINTENANCE_DONE:     "Estimado/a {nombre},\n\nSu solicitud de mantenimiento \"{titulo}\" ha sido completada. Si tiene alguna observación, no dude en contactarnos.\n\nAtentamente,\nAdministración",
  ANNOUNCEMENT:         "Estimados residentes,\n\n{titulo}\n\n{cuerpo}\n\nAtentamente,\nAdministración",
  ASSEMBLY_INVITE:      "Estimado/a {nombre},\n\nLe convocamos a la asamblea de propietarios a realizarse el {fecha} en {lugar}.\n\nSu participación es importante.\n\nAtentamente,\nJunta Directiva",
};

function EmailTemplatesTab({ organizationId }: { organizationId: string }) {
  const list = trpc.notifications.emailTemplates.list.useQuery({ organizationId });
  const upsert = trpc.notifications.emailTemplates.upsert.useMutation({ onSuccess: () => void list.refetch() });
  const [editing, setEditing] = useState<string | null>(null);
  const [draftSubject, setDraftSubject] = useState("");
  const [draftBody, setDraftBody] = useState("");

  const events = Object.keys(EVENT_LABELS) as string[];
  const templateMap = Object.fromEntries(
    list.data?.map((t) => [t.event, { subject: t.subject, body: t.body }]) ?? []
  );

  const startEdit = (event: string) => {
    setEditing(event);
    setDraftSubject(templateMap[event]?.subject ?? EMAIL_DEFAULT_SUBJECTS[event] ?? "");
    setDraftBody(templateMap[event]?.body ?? EMAIL_DEFAULT_BODIES[event] ?? "");
  };

  const save = async () => {
    if (!editing) return;
    await upsert.mutateAsync({
      organizationId,
      event: editing as Parameters<typeof upsert.mutateAsync>[0]["event"],
      subject: draftSubject,
      body: draftBody,
    });
    setEditing(null);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Plantillas de Email (Gmail)</h2>
        <p className="text-sm text-muted-foreground">
          Personaliza el asunto y cuerpo de los correos enviados automáticamente. Usa {"{variable}"} para datos dinámicos.
        </p>
        <p className="mt-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 inline-block">
          ⚠️ Recuerda configurar las variables de Gmail (SMTP_HOST, SMTP_USER, SMTP_PASS) en Vercel para que los correos se envíen.
        </p>
      </div>

      <div className="space-y-3">
        {events.map((event) => {
          const saved = templateMap[event];
          const isCustomized = !!saved;
          return (
            <div key={event} className="rounded-lg border bg-card p-4">
              {editing === event ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{EVENT_LABELS[event]}</p>
                    <div className="flex gap-2">
                      <button
                        className="rounded-md border px-3 py-1 text-sm hover:bg-muted"
                        onClick={() => setEditing(null)}
                      >
                        Cancelar
                      </button>
                      <Button size="sm" onClick={save} disabled={upsert.isPending}>
                        {upsert.isPending ? "Guardando..." : "Guardar"}
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">{EVENT_HINTS[event]}</p>
                  <div className="space-y-1">
                    <Label>Asunto del correo</Label>
                    <Input
                      value={draftSubject}
                      onChange={(e) => setDraftSubject(e.target.value)}
                      placeholder="Asunto del email..."
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Cuerpo del mensaje</Label>
                    <textarea
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      rows={7}
                      value={draftBody}
                      onChange={(e) => setDraftBody(e.target.value)}
                      placeholder="Escribe el cuerpo del email..."
                    />
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{EVENT_LABELS[event]}</p>
                    {isCustomized ? (
                      <>
                        <p className="mt-1 text-xs text-blue-700 font-medium truncate">
                          Asunto: {saved.subject}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{saved.body}</p>
                      </>
                    ) : (
                      <p className="mt-1 text-xs italic text-muted-foreground">Usando plantilla por defecto del sistema</p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground/60">{EVENT_HINTS[event]}</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => startEdit(event)}>
                    {isCustomized ? "Editar" : "Personalizar"}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HistoryTab({ organizationId, communityId }: { organizationId: string; communityId: string }) {
  const history = trpc.notifications.communityHistory.useQuery({ organizationId, communityId });

  const statusColors: Record<string, string> = {
    SENT: "text-green-600",
    FAILED: "text-destructive",
    PENDING: "text-yellow-600",
  };
  const statusLabels: Record<string, string> = {
    SENT: "Enviado",
    FAILED: "Error",
    PENDING: "Pendiente",
  };

  const channelLabel: Record<string, string> = { WHATSAPP: "WhatsApp", IN_APP: "In-App", EMAIL: "Email" };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Historial de notificaciones</h2>
      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Persona</th>
              <th className="px-3 py-2">Canal</th>
              <th className="px-3 py-2">Evento</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">Mensaje</th>
            </tr>
          </thead>
          <tbody>
            {history.data?.map((n) => (
              <tr key={n.id} className="border-t hover:bg-muted/30">
                <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                  {new Date(n.createdAt).toLocaleString("es-VE")}
                </td>
                <td className="px-3 py-2">
                  <div>{n.person ? `${n.person.firstName} ${n.person.lastName}` : "—"}</div>
                  {n.recipientEmail && (
                    <div className="text-xs text-muted-foreground">{n.recipientEmail}</div>
                  )}
                </td>
                <td className="px-3 py-2">{channelLabel[n.channel] ?? n.channel}</td>
                <td className="px-3 py-2 text-xs">{EVENT_LABELS[n.event] ?? n.event}</td>
                <td className={`px-3 py-2 font-medium ${statusColors[n.status] ?? ""}`}>
                  {statusLabels[n.status] ?? n.status}
                  {n.errorMessage && (
                    <div className="text-xs font-normal text-muted-foreground" title={n.errorMessage}>
                      {n.errorMessage.slice(0, 40)}…
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 max-w-xs truncate text-muted-foreground" title={n.body}>{n.body}</td>
              </tr>
            ))}
            {history.data?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Sin historial</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
