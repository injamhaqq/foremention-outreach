import Head from "next/head";
import type { GetServerSideProps } from "next";
import { getDb } from "@/lib/db";
import { evaluateHunterPersistenceReadiness } from "@/lib/hunter/persistence-readiness";

type HealthProps = {
  ok: boolean;
  version: string;
  persistenceReady: boolean;
  persistenceMode: string;
};

function healthVersion() {
  const appVersion = String(process.env.APP_VERSION || "").trim();
  if (appVersion && appVersion !== "dev") return appVersion;
  return String(process.env.RAILWAY_GIT_COMMIT_SHA || appVersion || "dev");
}

export const getServerSideProps: GetServerSideProps<HealthProps> = async ({ res }) => {
  try {
    const db = getDb();
    db.prepare("SELECT 1 AS ok").get();
    const persistence = evaluateHunterPersistenceReadiness(db);
    res.statusCode = 200;
    res.setHeader("Cache-Control", "no-store");
    return {
      props: {
        ok: true,
        version: healthVersion(),
        persistenceReady: persistence.ready,
        persistenceMode: persistence.mode,
      },
    };
  } catch {
    res.statusCode = 503;
    res.setHeader("Cache-Control", "no-store");
    return {
      props: {
        ok: false,
        version: healthVersion(),
        persistenceReady: false,
        persistenceMode: "unavailable",
      },
    };
  }
};

export default function HealthPage({ ok, version, persistenceReady, persistenceMode }: HealthProps) {
  return (
    <>
      <Head>
        <title>Foremention Outreach Health</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <main className="min-h-screen bg-base-100 flex items-center justify-center p-6">
        <div className="text-center">
          <div className={`text-lg font-semibold ${ok ? "text-success" : "text-error"}`}>
            {ok ? "ok" : "unhealthy"}
          </div>
          <div className="text-xs text-base-content/35 mt-1">Foremention Outreach · {version}</div>
          <div className="text-xs text-base-content/35 mt-1">
            Persistence · {persistenceReady ? "ready" : persistenceMode}
          </div>
        </div>
      </main>
    </>
  );
}
