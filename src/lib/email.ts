import emailjs from '@emailjs/browser';

const SERVICE_ID = 'service_fx31fw8';
const TENANT_TEMPLATE_ID = 'template_ikoy26j';
const LANDLORD_TEMPLATE_ID = 'template_nh1fu4e';
const PUBLIC_KEY = 'Kb82JX5v431Mn9Cbz';

let initialized = false;
function ensureInit() {
  if (!initialized) {
    try {
      emailjs.init(PUBLIC_KEY);
      initialized = true;
    } catch {
      initialized = true;
    }
  }
}

export interface EmailResult {
  success: boolean;
  error?: any;
}

async function send(templateId: string, params: Record<string, any>): Promise<EmailResult> {
  console.log(`[EmailJS] Attempting to send email. Template: ${templateId}`);
  try {
    const response = await emailjs.send(SERVICE_ID, templateId, params, {
      publicKey: PUBLIC_KEY,
    });
    console.log('[EmailJS] Email sent successfully!', response.status, response.text);
    return { success: true };
  } catch (err) {
    console.error('[EmailJS] Send error:', err);
    return { success: false, error: err };
  }
}

export async function sendTenantDecisionEmail(args: {
  toEmail: string;
  clientName?: string;
  vehicleTitle?: string;
  decision: 'approved' | 'rejected';
  ownerName?: string;
}): Promise<EmailResult> {
  const params = {
    to_email: args.toEmail,
    email: args.toEmail,           // Fallback if template uses {{email}}
    recipient_email: args.toEmail, // Fallback if template uses {{recipient_email}}
    client_email: args.toEmail,    // Fallback if template uses {{client_email}}
    to_name: args.clientName || 'Client',
    vehicle_title: args.vehicleTitle || 'Vehicle',
    decision: args.decision,
    owner_name: args.ownerName || 'Owner',
    app_name: 'RideHub',
    timestamp: new Date().toLocaleString(),
  };
  return await send(TENANT_TEMPLATE_ID, params);
}

export async function sendLandlordRentalEmail(args: {
  toEmail: string;
  ownerName?: string;
  vehicleTitle?: string;
  clientName: string;
  clientEmail: string;
  message?: string;
}): Promise<EmailResult> {
  const params = {
    to_email: args.toEmail,
    email: args.toEmail,           // Fallback if template uses {{email}}
    owner_email: args.toEmail,     // Fallback if template uses {{owner_email}}
    recipient_email: args.toEmail, // Fallback if template uses {{recipient_email}}
    owner_name: args.ownerName || 'Owner',
    vehicle_title: args.vehicleTitle || 'Vehicle',
    client_name: args.clientName,
    client_email: args.clientEmail,
    message: args.message || '',
    app_name: 'RideHub',
    timestamp: new Date().toLocaleString(),
  };
  return await send(LANDLORD_TEMPLATE_ID, params);
}

export async function sendOwnerRentalEmail(args: {
  toEmail: string;
  ownerName?: string;
  vehicleTitle?: string;
  clientName: string;
  clientEmail: string;
  message?: string;
}): Promise<EmailResult> {
  return sendLandlordRentalEmail(args);
}

