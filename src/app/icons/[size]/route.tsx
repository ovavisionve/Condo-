import { ImageResponse } from "next/og";

export const runtime = "edge";

// Genera íconos PNG para el manifest PWA en cualquier tamaño
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ size: string }> }
) {
  const { size: sizeStr } = await params;
  const size = parseInt(sizeStr, 10) || 192;

  // Colores del tema: sidebar oscuro + texto blanco
  const bg = "#1e293b";      // slate-800
  const accent = "#3b82f6";  // blue-500

  return new ImageResponse(
    (
      <div
        style={{
          width: size,
          height: size,
          background: bg,
          borderRadius: size * 0.2,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: size * 0.04,
        }}
      >
        {/* Edificio estilizado */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: size * 0.02,
          }}
        >
          {/* Techo */}
          <div
            style={{
              width: size * 0.45,
              height: size * 0.06,
              background: accent,
              borderRadius: size * 0.02,
            }}
          />
          {/* Cuerpo */}
          <div
            style={{
              width: size * 0.45,
              height: size * 0.28,
              background: "#334155",
              borderRadius: size * 0.02,
              display: "flex",
              flexWrap: "wrap",
              gap: size * 0.02,
              padding: size * 0.03,
              alignContent: "flex-start",
            }}
          >
            {/* Ventanas */}
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                style={{
                  width: size * 0.1,
                  height: size * 0.07,
                  background: i % 3 === 0 ? accent : "#f1f5f9",
                  borderRadius: size * 0.01,
                  opacity: 0.9,
                }}
              />
            ))}
          </div>
          {/* Base */}
          <div
            style={{
              width: size * 0.55,
              height: size * 0.04,
              background: "#475569",
              borderRadius: size * 0.01,
            }}
          />
        </div>

        {/* Texto */}
        <div
          style={{
            color: "#f8fafc",
            fontSize: size * 0.12,
            fontWeight: 700,
            letterSpacing: -0.5,
            marginTop: size * 0.02,
          }}
        >
          CONDO
        </div>
      </div>
    ),
    {
      width: size,
      height: size,
    }
  );
}
