import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const email = String(body.email || "").trim().toLowerCase();

    if (!email) {
      return NextResponse.json(
        { ok: false, error: "Email is required" },
        { status: 400 }
      );
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data, error } = await supabase
      .from("leads")
      .select("id, email, plan, created_at")
      .eq("email", email)
      .eq("plan", "full_report")
      .gte("created_at", thirtyDaysAgo.toISOString());

    if (error) {
      console.error("check-report-limit error:", error);
      return NextResponse.json(
        { ok: false, error: "Failed to check report limit" },
        { status: 500 }
      );
    }

    const count = data?.length || 0;
    const reachedLimit = count >= 3;

    return NextResponse.json({
      ok: true,
      reachedLimit,
      count,
    });
  } catch (error) {
    console.error("check-report-limit route error:", error);
    return NextResponse.json(
      { ok: false, error: "Unexpected server error" },
      { status: 500 }
    );
  }
}
