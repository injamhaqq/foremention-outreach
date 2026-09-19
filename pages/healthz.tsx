import Head from "next/head";
import type { GetServerSideProps } from "next";
import { getDb } from "@/lib/db";

type HealthProps = {
  ok: boolean;
  version: string;
};

export const getServerSideProps: GetServerSideProps<HealthProps> = async ({ res }) => {
  try {
    const db = getDb();
    db.prepare("SELECT 1 AS ok").get();
    res.statusCode = 200;
    res.setHeader("Cache-Control", "no-store");
    return {
      props: {
        ok: true,
        version: String(process.env.APP_VERSION || process.env.RAILWAY_GIT_COMMIT_SHA || "dev"),
      },
    };
  } catch {
    res.statusCode = 503;
    res.setHeader("Cache-Control", "no-store");
    return {
      props: {
        ok: false,
        version: String(process.env.APP_VERSION || "dev"),
      },
    };
  }
};

export default function HealthPage({ ok, version }: HealthProps) {
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
        </div>
      </main>
    </>
  );
}
