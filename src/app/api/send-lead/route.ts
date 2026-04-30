import { NextResponse } from "next/server";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function formatMoney(value: unknown) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return "-";
  return `$${Math.round(numberValue).toLocaleString("en-SG")}`;
}

function formatSqftFromSqm(value: unknown) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return "-";
  return `${Math.round(numberValue * 10.7639).toLocaleString("en-SG")} sqft`;
}

function getFirstAvailable(...values: unknown[]) {
  return values.find((value) => value !== null && value !== undefined && value !== "");
}

async function syncLeadToOffice(body: any) {
  const officeUrl = process.env.NEXDOOR_OFFICE_URL;
  const syncToken = process.env.HOMEVALUE_OFFICE_SYNC_TOKEN;

  if (!officeUrl || !syncToken) {
    console.warn("Office lead sync skipped: missing environment variables");
    return { ok: false, skipped: true };
  }

  const response = await fetch(`${officeUrl.replace(/\/$/, "")}/api/leads`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-nexdoor-source": "HomeValue",
      "x-nexdoor-sync-token": syncToken,
    },
    body: JSON.stringify({
      ...body,
      source: "HomeValue",
      pageSource: body.pageSource || body.page_source || "HomeValue",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown Office sync error");
    console.error("Office lead sync failed:", errorText);
    return { ok: false, skipped: false };
  }

  return { ok: true, skipped: false };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const {
      name,
      phone,
      email,
      address,
      unit_number,
      unit_type,
      floor_area_sqm,
      plan,
      estimated_price,
      estimated_low,
      estimated_high,
      estimatedPrice,
      estimatedLow,
      estimatedHigh,
    } = body;

    const intent = displayValue(plan || "Pending");
    const estimatedValue = getFirstAvailable(estimated_price, estimatedPrice);
    const lowRange = getFirstAvailable(estimated_low, estimatedLow);
    const highRange = getFirstAvailable(estimated_high, estimatedHigh);
    const rangeText =
      formatMoney(lowRange) === "-" && formatMoney(highRange) === "-"
        ? "-"
        : `${formatMoney(lowRange)} - ${formatMoney(highRange)}`;

    const officeSync = await syncLeadToOffice(body).catch((error) => {
      console.error("Office lead sync crash:", error);
      return { ok: false, skipped: false };
    });

    const isIntentUpdate = !!plan;
    const subject = isIntentUpdate
      ? `HomeValue Intent - ${intent}`
      : `New HomeValue Lead - ${address || "Valuation Completed"}`;

    const { data, error } = await resend.emails.send({
      from: "NexDoor <onboarding@resend.dev>",
      to: ["admin@nexdoor.sg"],
      subject,
      html: `
        <h2>${isIntentUpdate ? "HomeValue lead intent updated." : "New HomeValue lead received."}</h2>

        <p><strong>Name:</strong> ${displayValue(name)}</p>
        <p><strong>Phone:</strong> ${displayValue(phone)}</p>
        <p><strong>Email:</strong> ${displayValue(email)}</p>

        <p><strong>Address:</strong> ${displayValue(address)}</p>
        <p><strong>Unit:</strong> ${displayValue(unit_number)}</p>
        <p><strong>Property Type:</strong> ${displayValue(unit_type)}</p>
        <p><strong>Floor Area:</strong> ${formatSqftFromSqm(floor_area_sqm)}</p>

        <p><strong>Estimated Value:</strong> ${formatMoney(estimatedValue)}</p>
        <p><strong>Range:</strong> ${rangeText}</p>

        <p><strong>Intent:</strong> ${intent}</p>
        <p><strong>Office Sync:</strong> ${officeSync.ok ? "Synced" : officeSync.skipped ? "Skipped" : "Failed"}</p>
      `,
    });

    if (error) {
      console.error("Resend error:", error);
      return NextResponse.json(
        { success: false, error: error.message || "Failed to send email" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data, officeSync });
  } catch (err: any) {
    console.error("Send lead route error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Unexpected server error" },
      { status: 500 }
    );
  }
}
