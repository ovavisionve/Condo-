import { db } from "@/server/db/client";

/**
 * Resuelve qué email usar como LOGIN (User.email) para una Person, manejando el caso de
 * EMAILS COMPARTIDOS entre residentes distintos (ej. una familia con un solo Gmail para
 * 2 apartamentos — encontrado 03-jul-2026 en Arrayanes: Nohellys Román 41B / Maria Román
 * 43B ambas con "nohellysroman@gmail.com").
 *
 * Antes, el último residente en configurar su clave "robaba" el User compartido
 * (`otherPerson.userId = null`), dejando al otro sin acceso aunque ya hubiera configurado
 * la suya. Ahora, si el email base ya pertenece a OTRA persona activa, se genera un alias
 * único con "+" (ej. `nohellysroman+41b@gmail.com`). Gmail/Outlook entregan ese alias al
 * MISMO buzón (ignoran todo después del "+"), así que las notificaciones normales
 * (dirigidas a `Person.email`, sin tocar) siguen llegando igual al buzón familiar — solo
 * el LOGIN de cada residente queda separado. Se le muestra al residente su email exacto
 * de acceso (puede diferir de su email de contacto).
 */
export async function resolveLoginEmail(personId: string, baseEmail: string): Promise<string> {
  const emailLower = baseEmail.toLowerCase().trim();
  const existingUser = await db.user.findUnique({ where: { email: emailLower }, select: { id: true } });
  if (!existingUser) return emailLower;

  const linkedPerson = await db.person.findFirst({
    where: { userId: existingUser.id },
    select: { id: true, deletedAt: true },
  });
  // Libre, huérfano, o ya es de esta misma persona → sin conflicto, usar el email base.
  if (!linkedPerson || linkedPerson.deletedAt || linkedPerson.id === personId) {
    return emailLower;
  }

  // Tomado por OTRA persona activa → generar alias único "+unidad" (o últimos dígitos del id).
  const [local, domain] = emailLower.split("@");
  const ownership = await db.ownership.findFirst({
    where: { personId, endDate: null },
    select: { unit: { select: { code: true } } },
  });
  const tag = (ownership?.unit.code ?? personId.slice(-6)).toLowerCase().replace(/[^a-z0-9]/g, "");

  for (let suffix = 0; suffix < 5; suffix++) {
    const candidate = suffix === 0 ? `${local}+${tag}@${domain}` : `${local}+${tag}${suffix}@${domain}`;
    const candidateUser = await db.user.findUnique({ where: { email: candidate }, select: { id: true } });
    if (!candidateUser) return candidate;
    const candidateLinked = await db.person.findFirst({ where: { userId: candidateUser.id }, select: { id: true } });
    if (!candidateLinked || candidateLinked.id === personId) return candidate;
  }
  // Fallback extremo (no debería alcanzarse): sufijo con parte del personId, garantizado único.
  return `${local}+${tag}-${personId.slice(-4)}@${domain}`;
}
