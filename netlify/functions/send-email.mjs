import nodemailer from "nodemailer";

const SUPPORT_INBOX = "trustdansan@gmail.com";

const json = (statusCode, payload) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": process.env.URL ? `https://${new URL(process.env.URL).host}` : "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  },
  body: JSON.stringify(payload)
});

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return json(204, {});
  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "Use POST to send a support email." });
  }

  let data;
  try {
    data = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { ok: false, error: "The request was not valid JSON." });
  }

  const customerName = String(data.customerName || "Customer").trim().slice(0, 80) || "Customer";
  const service = String(data.service || "Bank information").trim().slice(0, 100) || "Bank information";
  const details = String(data.details || "The published information is not displaying in BUSINESS TOOLS.")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .slice(0, 1000);

  // These names match the Gmail settings required by the supplied send-email.mjs file.
  const gmailUser = process.env.GMAIL_USER;
  const gmailAppPassword = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailAppPassword) {
    console.error("Missing GMAIL_USER or GMAIL_APP_PASSWORD Netlify environment variable.");
    return json(500, {
      ok: false,
      error: "Email is not configured on this Netlify site. Check the existing GMAIL_USER and GMAIL_APP_PASSWORD settings."
    });
  }

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: gmailUser, pass: String(gmailAppPassword).replace(/\s+/g, "") }
    });

    const subject = "BUSINESS TOOLS — Customer Support Request";
    const text = [
      "A customer requested support from BUSINESS TOOLS.",
      "",
      `Customer: ${customerName}`,
      `Service: ${service}`,
      "",
      "Message:",
      details
    ].join("\n");

    await transporter.sendMail({
      from: { name: "BUSINESS TOOLS Support", address: gmailUser },
      to: SUPPORT_INBOX,
      subject,
      text
    });

    return json(200, { ok: true, message: "Support email sent successfully." });
  } catch (error) {
    console.error("BUSINESS TOOLS support email failed:", error?.message || error);
    return json(502, {
      ok: false,
      error: "Gmail could not send the message. Confirm the Netlify Gmail app-password settings are valid."
    });
  }
}
