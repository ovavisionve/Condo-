"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { useOrgId } from "../../../OrgContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function UnitsPage() {
  const { id: communityId } = useParams<{ id: string }>();
  const organizationId = useOrgId();
  const list = trpc.org.units.list.useQuery({ organizationId, communityId });
  const [showSingle, setShowSingle] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [filterTower, setFilterTower] = useState("");
  const [filterFloor, setFilterFloor] = useState("");

  const sumAliquot = list.data?.reduce((s, u) => s + Number(u.aliquot.toString()), 0) ?? 0;
  const remaining = Math.max(0, 100 - sumAliquot);

  const towers = Array.from(new Set(list.data?.map((u) => u.tower).filter(Boolean)));
  const floors = Array.from(new Set(list.data?.map((u) => u.floor).filter((f) => f != null))).sort((a, b) => (a ?? 0) - (b ?? 0));

  const filtered = list.data?.filter((u) => {
    if (filterTower && u.tower !== filterTower) return false;
    if (filterFloor && String(u.floor) !== filterFloor) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Unidades</h2>
          <p className="text-sm text-muted-foreground">
            Total alícuota: {sumAliquot.toFixed(4)}% · Disponible: {remaining.toFixed(4)}%
          </p>
        </div>
        <div className="flex items-center gap-2">
          {towers.length > 0 && (
            <select
              className="flex h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={filterTower}
              onChange={(e) => setFilterTower(e.target.value)}
            >
              <option value="">Todas las torres</option>
              {towers.map((t) => <option key={t!} value={t!}>Torre {t}</option>)}
            </select>
          )}
          {floors.length > 0 && (
            <select
              className="flex h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={filterFloor}
              onChange={(e) => setFilterFloor(e.target.value)}
            >
              <option value="">Todos los pisos</option>
              {floors.map((f) => <option key={f!} value={String(f)}>Piso {f}</option>)}
            </select>
          )}
          <Button variant="outline" onClick={() => setShowBulk(true)}>+ Crear varias</Button>
          <Button onClick={() => setShowSingle(true)}>+ Unidad</Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Torre</th>
              <th className="px-3 py-2">Piso</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Alícuota %</th>
              <th className="px-3 py-2">Área m²</th>
              <th className="px-3 py-2">Hab.</th>
              <th className="px-3 py-2">Propietario</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {filtered?.map((u) => {
              const owner = u.ownerships[0]?.person;
              return (
                <tr key={u.id} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2 font-medium">{u.code}</td>
                  <td className="px-3 py-2 text-muted-foreground">{u.tower ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{u.floor ?? "—"}</td>
                  <td className="px-3 py-2">{u.type}</td>
                  <td className="px-3 py-2">{Number(u.aliquot.toString()).toFixed(4)}</td>
                  <td className="px-3 py-2">{u.areaM2 ? Number(u.areaM2.toString()).toFixed(2) : "—"}</td>
                  <td className="px-3 py-2">{u.bedrooms ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {owner ? `${owner.firstName} ${owner.lastName}` : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/org/communities/${communityId}/units/${u.id}`}>
                      <Button size="sm" variant="outline">Ver</Button>
                    </Link>
                  </td>
                </tr>
              );
            })}
            {filtered?.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">Sin unidades</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showSingle && (
        <SingleUnitDialog
          organizationId={organizationId}
          communityId={communityId}
          remaining={remaining}
          onClose={() => setShowSingle(false)}
          onCreated={() => { setShowSingle(false); void list.refetch(); }}
        />
      )}
      {showBulk && (
        <BulkUnitsDialog
          organizationId={organizationId}
          communityId={communityId}
          onClose={() => setShowBulk(false)}
          onCreated={() => { setShowBulk(false); void list.refetch(); }}
        />
      )}
    </div>
  );
}

function SingleUnitDialog({ organizationId, communityId, remaining, onClose, onCreated }: {
  organizationId: string;
  communityId: string;
  remaining: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const create = trpc.org.units.create.useMutation();
  const [form, setForm] = useState({
    code: "",
    aliquot: "",
    type: "APARTMENT" as const,
    floor: "",
    tower: "",
    bedrooms: "",
    bathrooms: "",
    areaM2: "",
    parkingSpots: "0",
  });
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await create.mutateAsync({
        organizationId,
        communityId,
        code: form.code,
        aliquot: Number(form.aliquot),
        type: form.type,
        floor: form.floor ? Number(form.floor) : undefined,
        tower: form.tower || undefined,
        bedrooms: form.bedrooms ? Number(form.bedrooms) : undefined,
        bathrooms: form.bathrooms ? Number(form.bathrooms) : undefined,
        areaM2: form.areaM2 ? Number(form.areaM2) : undefined,
        parkingSpots: Number(form.parkingSpots) || 0,
      });
      onCreated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
        <h3 className="mb-4 text-lg font-semibold">Nueva unidad</h3>
        <p className="mb-3 text-xs text-muted-foreground">Disponible: {remaining.toFixed(4)}%</p>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Código</Label>
              <Input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} required />
            </div>
            <div>
              <Label>Alícuota %</Label>
              <Input type="number" step="0.0001" value={form.aliquot}
                onChange={(e) => setForm((f) => ({ ...f, aliquot: e.target.value }))} required />
            </div>
            <div>
              <Label>Torre</Label>
              <Input value={form.tower} placeholder="A, B, Norte..." onChange={(e) => setForm((f) => ({ ...f, tower: e.target.value }))} />
            </div>
            <div>
              <Label>Piso</Label>
              <Input type="number" min={0} value={form.floor} onChange={(e) => setForm((f) => ({ ...f, floor: e.target.value }))} />
            </div>
            <div>
              <Label>Habitaciones</Label>
              <Input type="number" value={form.bedrooms} onChange={(e) => setForm((f) => ({ ...f, bedrooms: e.target.value }))} />
            </div>
            <div>
              <Label>Baños</Label>
              <Input type="number" value={form.bathrooms} onChange={(e) => setForm((f) => ({ ...f, bathrooms: e.target.value }))} />
            </div>
            <div>
              <Label>Área m²</Label>
              <Input type="number" step="0.01" value={form.areaM2} onChange={(e) => setForm((f) => ({ ...f, areaM2: e.target.value }))} />
            </div>
            <div>
              <Label>Estacionamientos</Label>
              <Input type="number" value={form.parkingSpots} onChange={(e) => setForm((f) => ({ ...f, parkingSpots: e.target.value }))} />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? "..." : "Crear"}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function BulkUnitsDialog({ organizationId, communityId, onClose, onCreated }: {
  organizationId: string;
  communityId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const bulk = trpc.org.units.bulkCreate.useMutation();
  const [count, setCount] = useState(10);
  const [prefix, setPrefix] = useState("A-");
  const [error, setError] = useState<string | null>(null);

  const aliquotEach = count > 0 ? 100 / count : 0;
  const units = Array.from({ length: count }, (_, i) => ({
    code: `${prefix}${String(i + 1).padStart(2, "0")}`,
    aliquot: aliquotEach,
    type: "APARTMENT" as const,
  }));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await bulk.mutateAsync({ organizationId, communityId, units });
      onCreated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
        <h3 className="mb-1 text-lg font-semibold">Crear varias unidades</h3>
        <p className="mb-4 text-xs text-muted-foreground">Distribución uniforme del 100% entre las unidades.</p>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Cantidad</Label>
              <Input type="number" min={1} max={500} value={count} onChange={(e) => setCount(Number(e.target.value))} required />
            </div>
            <div>
              <Label>Prefijo del código</Label>
              <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} required />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Generará: <strong>{units[0]?.code}</strong> ... <strong>{units[units.length - 1]?.code}</strong> · alícuota {aliquotEach.toFixed(4)}% c/u
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={bulk.isPending}>{bulk.isPending ? "..." : "Crear todas"}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
