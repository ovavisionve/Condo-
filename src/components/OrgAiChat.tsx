"use client";

import { useOrgId } from "@/app/org/OrgContext";
import { AiChatWidget } from "@/components/AiChatWidget";

export function OrgAiChat() {
  const organizationId = useOrgId();
  return <AiChatWidget organizationId={organizationId} module="residential" />;
}
