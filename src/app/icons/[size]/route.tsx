import { ImageResponse } from "next/og";

export const runtime = "edge";

// Genera íconos PNG para el manifest PWA en cualquier tamaño
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ size: string }> }
) {
  const { size: sizeStr } = await params;
  const size = parseInt(sizeStr, 10) || 192;

  // Nodos de la red neuronal (coordenadas en ViewBox 0 0 100 100)
  const nodes = [
    { cx: 50, cy: 32 }, // top
    { cx: 63, cy: 40 }, // top-right
    { cx: 62, cy: 55 }, // bottom-right
    { cx: 50, cy: 63 }, // bottom
    { cx: 37, cy: 56 }, // bottom-left
    { cx: 36, cy: 41 }, // top-left
  ];

  // Todas las líneas entre pares de nodos (grafo completo)
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      lines.push({
        x1: nodes[i]!.cx, y1: nodes[i]!.cy,
        x2: nodes[j]!.cx, y2: nodes[j]!.cy,
      });
    }
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: size,
          height: size,
          background: "#1e293b",
          borderRadius: size * 0.18,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        <svg
          viewBox="0 0 100 100"
          width={size * 0.88}
          height={size * 0.88}
          style={{ display: "block" }}
        >
          {/* ── Edificio (blanco) ─────────────────────────────── */}

          {/* Cornisa / techo */}
          <rect x="2" y="20" width="96" height="8" rx="2" fill="white" />

          {/* Sección izquierda superior */}
          <rect x="2" y="28" width="35" height="3" fill="white" />
          <rect x="4"  y="31" width="6" height="15" rx="0.5" fill="white" />
          <rect x="13" y="31" width="6" height="15" rx="0.5" fill="white" />
          <rect x="22" y="31" width="6" height="15" rx="0.5" fill="white" />

          {/* Sección derecha superior */}
          <rect x="63" y="28" width="35" height="3" fill="white" />
          <rect x="65" y="31" width="6" height="15" rx="0.5" fill="white" />
          <rect x="74" y="31" width="6" height="15" rx="0.5" fill="white" />
          <rect x="83" y="31" width="6" height="15" rx="0.5" fill="white" />

          {/* Losa intermedia */}
          <rect x="2" y="46" width="96" height="6" fill="white" />

          {/* Sección izquierda inferior */}
          <rect x="2" y="52" width="35" height="3" fill="white" />
          <rect x="4"  y="55" width="6" height="19" rx="0.5" fill="white" />
          <rect x="13" y="55" width="6" height="19" rx="0.5" fill="white" />
          <rect x="22" y="55" width="6" height="19" rx="0.5" fill="white" />

          {/* Sección derecha inferior */}
          <rect x="63" y="52" width="35" height="3" fill="white" />
          <rect x="65" y="55" width="6" height="19" rx="0.5" fill="white" />
          <rect x="74" y="55" width="6" height="19" rx="0.5" fill="white" />
          <rect x="83" y="55" width="6" height="19" rx="0.5" fill="white" />

          {/* Base */}
          <rect x="2" y="74" width="96" height="5" rx="1" fill="white" />

          {/* ── Red neuronal (azul, centro) ───────────────────── */}

          {/* Líneas */}
          {lines.map((l, i) => (
            <line
              key={i}
              x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
              stroke="#60a5fa"
              strokeWidth="1.1"
              opacity="0.85"
            />
          ))}

          {/* Nodos */}
          {nodes.map((n, i) => (
            <g key={i}>
              <circle cx={n.cx} cy={n.cy} r="3.8" fill="#3b82f6" opacity="0.9" />
              <circle cx={n.cx} cy={n.cy} r="1.8" fill="white" />
            </g>
          ))}
        </svg>
      </div>
    ),
    { width: size, height: size }
  );
}
