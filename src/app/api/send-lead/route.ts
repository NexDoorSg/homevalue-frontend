import { NextResponse } from "next/server";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const whatsappAccessToken = process.env.WHATSAPP_ACCESS_TOKEN;
const whatsappPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
const whatsappTemplateName = process.env.WHATSAPP_TEMPLATE_NAME || "homevalue_intro";
const whatsappTemplateLanguageCode =
  process.env.WHATSAPP_TEMPLATE_LANGUAGE_CODE || "en";

const whatsappAgentDetails: Record<string, { name: string; phone: string }> = {
  "bjornlim@nexdoor.sg": {
    name: process.env.WHATSAPP_AGENT_BJORN_NAME || "Bjorn Lim",
    phone: process.env.WHATSAPP_AGENT_BJORN_PHONE || "",
  },
  "abigailtang@nexdoor.sg": {
    name: process.env.WHATSAPP_AGENT_ABIGAIL_NAME || "Abigail Tang",
    phone: process.env.WHATSAPP_AGENT_ABIGAIL_PHONE || "",
  },
  "daveteo@nexdoor.sg": {
    name: process.env.WHATSAPP_AGENT_DAVE_NAME || "Dave Teo",
    phone: process.env.WHATSAPP_AGENT_DAVE_PHONE || "",
  },
};

const whatsappIntentAliases = new Set([
  "sell",
  "selling",
  "looking to sell",
  "thinking of selling",
  "buy",
  "buying",
  "looking to buy",
  "thinking of buying",
  "just exploring",
  "just exploring my options",
  "exploring",
]);

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

function normaliseWhatsappRecipient(phone: string) {
  const digitsOnly = phone.replace(/\D/g, "");

  if (!digitsOnly) return null;
  if (digitsOnly.startsWith("65")) return digitsOnly;
  if (digitsOnly.length === 8) return `65${digitsOnly}`;

  return digitsOnly;
}

function normaliseLeadIntent(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shouldSendWhatsappForIntent(plan: unknown) {
  const normalisedPlan = normaliseLeadIntent(plan);

  if (!normalisedPlan) return false;

  return whatsappIntentAliases.has(normalisedPlan);
}

function getWhatsappAgentDetails(assignedTo: string | null) {
  const normalisedAssignedTo = String(assignedTo || "").trim().toLowerCase();

  return (
    whatsappAgentDetails[normalisedAssignedTo] || {
      name: process.env.WHATSAPP_CONSULTANT_NAME || "Bjorn Lim",
      phone: process.env.WHATSAPP_CONSULTANT_PHONE || "",
    }
  );
}

async function sendHomeValueWhatsappIntro({
  name,
  phone,
  assignedTo,
}: {
  name: string;
  phone: string;
  assignedTo: string | null;
}) {
  if (!whatsappAccessToken || !whatsappPhoneNumberId) {
    console.warn(
      "WhatsApp intro skipped: missing WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID"
    );
    return;
  }

  const recipient = normaliseWhatsappRecipient(phone);
  if (!recipient) {
    console.warn("WhatsApp intro skipped: invalid phone number");
    return;
  }

  const agent = getWhatsappAgentDetails(assignedTo);
  if (!agent.phone) {
    console.warn(
      `WhatsApp intro skipped: missing phone for assigned agent ${assignedTo}`
    );
    return;
  }

  const response = await fetch(
    `https://graph.facebook.com/v20.0/${whatsappPhoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${whatsappAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: recipient,
        type: "template",
        template: {
          name: whatsappTemplateName,
          language: {
            code: whatsappTemplateLanguageCode,
          },
          components: [
            {
              type: "body",
              parameters: [
                {
                  type: "text",
                  text: name,
                },
                {
                  type: "text",
                  text: agent.name,
                },
                {
                  type: "text",
                  text: agent.phone,
                },
              ],
            },
          ],
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error("WhatsApp intro send failed:", errorText);
    return;
  }

  console.info(`WhatsApp intro sent for HomeValue lead assigned to ${assignedTo}`);
}

async function syncLeadToOffice(body: any) {
  const officeUrl = process.env.NEXDOOR_OFFICE_URL;
  const syncToken = process.env.HOMEVALUE_OFFICE_SYNC_TOKEN;

  if (!officeUrl || !syncToken) {
    console.warn("Office lead sync skipped: missing environment variables");
    return { ok: false, skipped: true, assignedTo: null as string | null };
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
    return { ok: false, skipped: false, assignedTo: null as string | null };
  }

  const officeLead = await response.json().catch(() => null);

  return {
    ok: true,
    skipped: false,
    assignedTo: officeLead?.assignedTo || null,
  };
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
    const isIntentUpdate = !!plan;
    const shouldSendWhatsappIntro = shouldSendWhatsappForIntent(plan);
    const estimatedValue = getFirstAvailable(estimated_price, estimatedPrice);
    const lowRange = getFirstAvailable(estimated_low, estimatedLow);
    const highRange = getFirstAvailable(estimated_high, estimatedHigh);
    const rangeText =
      formatMoney(lowRange) === "-" && formatMoney(highRange) === "-"
        ? "-"
        : `${formatMoney(lowRange)} - ${formatMoney(highRange)}`;

    const officeSync = await syncLeadToOffice(body).catch((error) => {
      console.error("Office lead sync crash:", error);
      return { ok: false, skipped: false, assignedTo: null as string | null };
    });

    if (officeSync.ok && shouldSendWhatsappIntro) {
      try {
        await sendHomeValueWhatsappIntro({
          name: String(name || "").trim(),
          phone: String(phone || "").trim(),
          assignedTo: officeSync.assignedTo,
        });
      } catch (whatsappError) {
        console.error("WhatsApp intro route error:", whatsappError);
      }
    } else if (!officeSync.ok) {
      console.warn("WhatsApp intro skipped because Office sync did not succeed");
    } else if (!plan) {
      console.info("WhatsApp intro skipped because no HomeValue intent was selected");
    } else {
      console.info(`WhatsApp intro skipped because HomeValue intent was not recognised: ${plan}`);
    }

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
        <p><strong>Assigned To:</strong> ${displayValue(officeSync.assignedTo)}</p>
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
