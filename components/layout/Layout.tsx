import { ReactNode, useCallback } from "react";
import { useRouter } from "next/router";
import Sidebar from "./Sidebar";
import TourGate from "@/components/onboarding/TourGate";

const NO_LAYOUT_PATHS = ["/login"];

export default function Layout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const handleCollapse = useCallback((_c: boolean) => {}, []);

  if (NO_LAYOUT_PATHS.includes(router.pathname)) {
    return <>{children}</>;
  }

  return (
    <div className="h-screen overflow-hidden bg-base-100 flex">
      <TourGate />
      <Sidebar onCollapse={handleCollapse} />
      <main className="ml-13 flex-1 p-6 overflow-y-auto transition-[margin] duration-200">
        <div role="note" className="mb-4 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] text-base-content/60">
          Foremention build: LinkedIn automation (login, visits, connects, messages, Sales Navigator import, scraping) is disabled. LinkedIn is draft-only and sent by hand. Outbound email is locked unless the founder unlocks it.
        </div>
        {children}
      </main>
    </div>
  );
}
