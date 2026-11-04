import { NextResponse } from "next/server";
import { APP_VERSION } from "@/lib/appUpdate";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { version: APP_VERSION },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "CDN-Cache-Control": "no-store",
        "Vercel-CDN-Cache-Control": "no-store",
      },
    },
  );
}
