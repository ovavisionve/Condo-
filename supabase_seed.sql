-- =========================================================
-- Condominios – Seed data
-- Paste this in Supabase SQL Editor AFTER running the schema
-- Admin login: admin@condominios.local / admin1234
-- =========================================================

DO $$ DECLARE
  v_owner_id TEXT;
  v_org_id   TEXT;
  v_pro_id   TEXT;
  v_starter_id TEXT;
  v_enterprise_id TEXT;
  v_community_id TEXT := 'hugo-chavez-frias-seed';
  v_floor INT;
  v_apt  TEXT;
  v_code TEXT;
BEGIN

-- Plans
INSERT INTO "Plan" (id, code, name, description, "maxCommunities", "maxUnits", "priceUsd", features, "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'STARTER', 'Starter', 'Para un solo edificio pequeño', 1, 50, 25, '{"whatsapp":false,"advancedReports":false,"customBranding":false}'::jsonb, now(), now()),
  (gen_random_uuid()::text, 'PRO', 'Pro', 'Para administradoras pequeñas', 5, 500, 99, '{"whatsapp":true,"advancedReports":true,"customBranding":false}'::jsonb, now(), now()),
  (gen_random_uuid()::text, 'ENTERPRISE', 'Enterprise', 'Sin límites', 999, 99999, 299, '{"whatsapp":true,"advancedReports":true,"customBranding":true,"api":true}'::jsonb, now(), now())
ON CONFLICT (code) DO NOTHING;

SELECT id INTO v_starter_id FROM "Plan" WHERE code = 'STARTER';
SELECT id INTO v_pro_id FROM "Plan" WHERE code = 'PRO';
SELECT id INTO v_enterprise_id FROM "Plan" WHERE code = 'ENTERPRISE';

-- Platform owner user
INSERT INTO "User" (id, email, name, "passwordHash", "emailVerified", active, "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'admin@condominios.local', 'Platform Owner', '$argon2id$v=19$m=65536,t=3,p=4$rHxIDgpTXlhRrFAYvO/enQ$3QVZ93J6frXMZGknWGNAj0O/xFbDnsTbqYqfYiXVt2g', now(), true, now(), now())
ON CONFLICT (email) DO UPDATE SET "passwordHash" = EXCLUDED."passwordHash", active = true;

SELECT id INTO v_owner_id FROM "User" WHERE email = 'admin@condominios.local';

-- Platform membership
INSERT INTO "Membership" (id, "userId", scope, role, "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, v_owner_id, 'PLATFORM', 'PLATFORM_OWNER', now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM "Membership" WHERE "userId" = v_owner_id AND scope = 'PLATFORM' AND role = 'PLATFORM_OWNER'
);

-- Organization
INSERT INTO "Organization" (id, slug, name, "legalName", email, city, country, "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'administradora-demo', 'Administradora Demo', 'Administradora Demo C.A.', 'admin@condominios.local', 'Caracas', 'VE', now(), now())
ON CONFLICT (slug) DO NOTHING;

SELECT id INTO v_org_id FROM "Organization" WHERE slug = 'administradora-demo';

-- ORG_ADMIN membership
INSERT INTO "Membership" (id, "userId", "organizationId", scope, role, "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, v_owner_id, v_org_id, 'ORGANIZATION', 'ORG_ADMIN', now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM "Membership" WHERE "userId" = v_owner_id AND "organizationId" = v_org_id AND role = 'ORG_ADMIN'
);

-- Subscription
INSERT INTO "Subscription" (id, "organizationId", "planId", status, "currentPeriodStart", "currentPeriodEnd", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, v_org_id, v_pro_id, 'ACTIVE', now(), now() + interval '365 days', now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM "Subscription" WHERE "organizationId" = v_org_id
);

-- Community Hugo Chavez Frias
INSERT INTO "Community" (id, "organizationId", name, address, city, state, country, "totalUnits", "floorsCount", "towersCount", "primaryCurrency", "createdAt", "updatedAt")
VALUES (v_community_id, v_org_id, 'Residencias Hugo Chávez Frías', 'Av. Principal de las Mercedes, Res. Hugo Chávez Frías', 'Caracas', 'Distrito Capital', 'VE', 40, 10, 1, 'USD', now(), now())
ON CONFLICT (id) DO NOTHING;

-- Community membership for owner
INSERT INTO "Membership" (id, "userId", "organizationId", "communityId", scope, role, "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, v_owner_id, v_org_id, v_community_id, 'COMMUNITY', 'COMMUNITY_ADMIN', now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM "Membership" WHERE "userId" = v_owner_id AND "communityId" = v_community_id AND role = 'COMMUNITY_ADMIN'
);

-- 40 units: floors 1-10, apts A-D
FOREACH v_floor IN ARRAY ARRAY[1,2,3,4,5,6,7,8,9,10] LOOP
  FOREACH v_apt IN ARRAY ARRAY['A','B','C','D'] LOOP
    v_code := v_floor::text || v_apt;
    INSERT INTO "Unit" (id, "organizationId", "communityId", code, type, floor, aliquot, bedrooms, bathrooms, "createdAt", "updatedAt")
    SELECT gen_random_uuid()::text, v_org_id, v_community_id, v_code, 'APARTMENT', v_floor, 2.500000, 3, 2, now(), now()
    WHERE NOT EXISTS (
      SELECT 1 FROM "Unit" WHERE "communityId" = v_community_id AND code = v_code
    );
  END LOOP;
END LOOP;

RAISE NOTICE 'Seed completado. Login: admin@condominios.local / admin1234';
END $$;
