import { NextResponse } from "next/server";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

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
    } = body;

    const { data, error } = await resend.emails.send({
      from: "NexDoor <onboarding@resend.dev>",
      to: ["admin@nexdoor.sg"],
      subject: `New Lead: ${plan || "HomeValue"}`,
      html: `
        <h2>New Lead Received</h2>
        <p><strong>Plan:</strong> ${plan || "-"}</p>
        <p><strong>Name:</strong> ${name || "-"}</p>
        <p><strong>Phone:</strong> ${phone || "-"}</p>
        <p><strong>Email:</strong> ${email || "-"}</p>
        <p><strong>Address:</strong> ${address || "-"}</p>
        <p><strong>Unit Number:</strong> ${unit_number || "-"}</p>
        <p><strong>Unit Type:</strong> ${unit_type || "-"}</p>
        <p><strong>Floor Area (sqm):</strong> ${floor_area_sqm || "-"}</p>
      `,
    });

    if (error) {
      console.error("Resend error:", error);
      return NextResponse.json(
        { success: false, error: error.message || "Failed to send email" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    console.error("Send lead route error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Unexpected server error" },
      { status: 500 }
    );
  }
}
