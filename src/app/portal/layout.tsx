import { InactivityGuard } from "@/components/InactivityGuard";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <InactivityGuard />
    </>
  );
}
