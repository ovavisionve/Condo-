import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/server/trpc/routers/_app";
import { createContext } from "@/server/trpc/init";

// Algunas mutaciones (envío masivo de emails/tutoriales) procesan ~188 destinatarios.
// Subido a 300s (03-jul-2026): sendEmailAllAtOnce ahora también genera y adjunta el PDF
// de cada recibo (render + queries extra por unidad), lo que añade tiempo al envío masivo.
export const maxDuration = 300;

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext,
    onError:
      process.env.NODE_ENV === "development"
        ? ({ path, error }) => {
            console.error(`tRPC error on ${path ?? "<no-path>"}:`, error.message);
          }
        : undefined,
  });

export { handler as GET, handler as POST };
