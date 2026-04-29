import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

async function main() {
  const adminEmail = (process.env.PLATFORM_OWNER_EMAIL ?? "admin@condominios.local").toLowerCase();
  const adminPassword = process.env.PLATFORM_OWNER_PASSWORD ?? "admin1234";

  console.log("🌱 Sembrando catálogo de planes...");
  const [starter, pro, enterprise] = await Promise.all([
    db.plan.upsert({
      where: { code: "STARTER" },
      update: {},
      create: {
        code: "STARTER",
        name: "Starter",
        description: "Para un solo edificio pequeño",
        maxCommunities: 1,
        maxUnits: 50,
        priceUsd: 25,
        features: { whatsapp: false, advancedReports: false, customBranding: false },
      },
    }),
    db.plan.upsert({
      where: { code: "PRO" },
      update: {},
      create: {
        code: "PRO",
        name: "Pro",
        description: "Para administradoras pequeñas",
        maxCommunities: 5,
        maxUnits: 500,
        priceUsd: 99,
        features: { whatsapp: true, advancedReports: true, customBranding: false },
      },
    }),
    db.plan.upsert({
      where: { code: "ENTERPRISE" },
      update: {},
      create: {
        code: "ENTERPRISE",
        name: "Enterprise",
        description: "Sin límites",
        maxCommunities: 999,
        maxUnits: 99999,
        priceUsd: 299,
        features: { whatsapp: true, advancedReports: true, customBranding: true, api: true },
      },
    }),
  ]);

  console.log(`🌱 Creando PLATFORM_OWNER (${adminEmail})...`);
  const passwordHash = await bcrypt.hash(adminPassword, 12);
  const owner = await db.user.upsert({
    where: { email: adminEmail },
    update: { passwordHash, active: true },
    create: {
      email: adminEmail,
      name: "Platform Owner",
      passwordHash,
      emailVerified: new Date(),
    },
  });

  // Postgres trata NULL != NULL en unique constraints, así que upsert no funciona
  // con scope PLATFORM (organizationId/communityId son null). Usamos findFirst.
  const existingMembership = await db.membership.findFirst({
    where: { userId: owner.id, scope: "PLATFORM", role: "PLATFORM_OWNER" },
  });
  if (!existingMembership) {
    await db.membership.create({
      data: { userId: owner.id, scope: "PLATFORM", role: "PLATFORM_OWNER" },
    });
  }

  // ─── Organización demo ───────────────────────────────────────────────────
  console.log("🌱 Creando organización demo...");
  const org = await db.organization.upsert({
    where: { slug: "administradora-demo" },
    update: {},
    create: {
      slug: "administradora-demo",
      name: "Administradora Demo",
      legalName: "Administradora Demo C.A.",
      email: adminEmail,
      city: "Caracas",
      country: "VE",
    },
  });

  // Membresía ORG_ADMIN del owner en la organización demo
  const existingOrgMembership = await db.membership.findFirst({
    where: { userId: owner.id, organizationId: org.id, role: "ORG_ADMIN" },
  });
  if (!existingOrgMembership) {
    await db.membership.create({
      data: {
        userId: owner.id,
        organizationId: org.id,
        scope: "ORGANIZATION",
        role: "ORG_ADMIN",
      },
    });
  }

  // Suscripción pro para la org demo
  await db.subscription.upsert({
    where: { organizationId: org.id },
    update: {},
    create: {
      organizationId: org.id,
      planId: pro.id,
      status: "ACTIVE",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
  });

  // ─── Comunidad Hugo Chávez Frías (40 unidades) ──────────────────────────
  console.log("🌱 Creando comunidad Residencias Hugo Chávez Frías...");
  const community = await db.community.upsert({
    where: { id: "hugo-chavez-frias-seed" },
    update: {},
    create: {
      id: "hugo-chavez-frias-seed",
      organizationId: org.id,
      name: "Residencias Hugo Chávez Frías",
      address: "Av. Principal de las Mercedes, Res. Hugo Chávez Frías",
      city: "Caracas",
      state: "Distrito Capital",
      country: "VE",
      totalUnits: 40,
      floorsCount: 10,
      towersCount: 1,
      primaryCurrency: "USD",
    },
  });

  // ─── 40 unidades: pisos 1–10, apartamentos A–D, alícuota 2.5% ──────────
  console.log("🌱 Creando 40 unidades...");
  const FLOORS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const APTS = ["A", "B", "C", "D"];
  const ALIQUOT = "2.500000"; // 100 / 40 = 2.5

  for (const floor of FLOORS) {
    for (const apt of APTS) {
      const code = `${floor}${apt}`;
      const existingUnit = await db.unit.findFirst({
        where: { communityId: community.id, code },
      });
      if (!existingUnit) {
        await db.unit.create({
          data: {
            organizationId: org.id,
            communityId: community.id,
            code,
            type: "APARTMENT",
            floor,
            aliquot: ALIQUOT,
            bedrooms: 3,
            bathrooms: 2,
          },
        });
      }
    }
  }

  console.log("✅ Seed completo.");
  console.log(`   Login: ${adminEmail}`);
  console.log(`   Password: ${adminPassword}`);
  console.log(`   Planes: ${[starter.code, pro.code, enterprise.code].join(", ")}`);
  console.log(`   Organización: ${org.name} (${org.id})`);
  console.log(`   Comunidad: ${community.name} (${community.id})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
