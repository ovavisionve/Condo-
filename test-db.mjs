import { PrismaClient } from "@prisma/client";

const db = new PrismaClient({
  datasources: {
    db: {
      url: "postgresql://postgres.nawbxhpndosiigzpnwlt:FablethE21.$@aws-1-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"
    }
  }
});

try {
  const n = await db.user.count();
  console.log("✅ Conexión OK - Users:", n);
} catch (e) {
  console.error("❌ Error:", e.message.split('\n')[0]);
} finally {
  await db.$disconnect();
}
