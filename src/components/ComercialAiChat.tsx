"use client";

import { useComercial } from "@/app/comercial/ComercialContext";
import { AiChatWidget } from "@/components/AiChatWidget";

export function ComercialAiChat() {
  const { selectedOrgId } = useComercial();
  return <AiChatWidget organizationId={selectedOrgId} module="commercial" />;
}
