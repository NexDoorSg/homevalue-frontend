import { NextResponse } from "next/server";
import { buildLeadSyncPayload } from "@/lib/propertyIdentity";
import { parseHomeValueWhatsAppConsent } from "@/lib/whatsappConsent";

export const maxDuration = 60;

// Office is the sole notification/acknowledgement owner. Never return or log
// provider bodies, contact details, assignment, credentials or raw exceptions.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request.' }, { status: 400 });
  }
  let whatsappConsent;
  try { whatsappConsent = parseHomeValueWhatsAppConsent(body.whatsappConsent); }
  catch { return NextResponse.json({ success: false, error: 'Invalid WhatsApp consent evidence.' }, { status: 400 }); }
  const officeUrl = process.env.NEXDOOR_OFFICE_URL;
  const syncToken = process.env.HOMEVALUE_OFFICE_SYNC_TOKEN;
  if (!officeUrl || !syncToken) {
    console.warn('HomeValue handoff unavailable', { code: 'configuration' });
    return NextResponse.json({ success: false, error: 'Receipt unavailable. Keep your saved request and retry later.' }, { status: 503 });
  }
  const payload = buildLeadSyncPayload(body, {
    canonicalProjectName: body.project_name, postalCode: body.postal_code,
    address: body.address, unitNumber: body.unit_number,
  });
  try {
    const response = await fetch(`${officeUrl.replace(/\/$/, '')}/api/leads`, {
      method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/json', 'x-nexdoor-source': 'HomeValue', 'x-nexdoor-sync-token': syncToken },
      body: JSON.stringify({ ...payload, whatsappConsent, source: 'HomeValue', pageSource: body.pageSource || body.page_source || 'HomeValue' }),
    });
    if (!response.ok) {
      console.warn('HomeValue handoff rejected', { code: 'office_response', status: response.status });
      const review = response.status === 400 || response.status === 409 || response.status === 422;
      return NextResponse.json({ success: false, error: review ? 'Your saved request needs review. Please contact NexDoor.' : 'Receipt could not be confirmed. Retry your saved request.' }, { status: review ? 409 : 502 });
    }
    // A successful Office response follows the canonical transaction. Its body
    // contains private CRM details and is deliberately not consumed or forwarded.
    return NextResponse.json({ success: true });
  } catch {
    console.warn('HomeValue handoff unavailable', { code: 'transport' });
    return NextResponse.json({ success: false, error: 'Receipt could not be confirmed. Retry your saved request.' }, { status: 502 });
  }
}
