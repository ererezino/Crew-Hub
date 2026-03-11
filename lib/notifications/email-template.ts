import "server-only";

/* ---------------------------------------------------------------------------
 * Crew Hub Branded HTML Email Template
 *
 * Every outbound email passes through renderEmailTemplate(). The design
 * matches the Crew Hub Brand Identity Guidelines exactly:
 *   Cream canvas #FFFAF3, white card, orange accent bar, DM Sans + Playfair
 *   Display typography, left-aligned CTA button, info blocks on #FAFAF7.
 *
 * Exports:
 *   renderEmailTemplate(options)  - full email wrapper
 *   renderInfoBlock(rows)         - detail rows (leave type, dates, etc.)
 *   renderButton(label, url, style) - standalone button
 * -------------------------------------------------------------------------*/

export interface EmailTemplateOptions {
  preheaderText: string;
  greeting: string;
  bodyHtml: string;
  ctaButton?: {
    label: string;
    url: string;
    style: "cta" | "primary";
  };
  closingText?: string;
  footerOverride?: string;
}

export function renderButton(
  label: string,
  url: string,
  style: "cta" | "primary"
): string {
  const bgColor = style === "cta" ? "#FD8B05" : "#000000";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
  <tr>
    <td align="left" style="border-radius:10px;background:${bgColor};">
      <a href="${escapeAttr(url)}" target="_blank" style="display:inline-block;padding:14px 32px;font-family:'DM Sans',Arial,Helvetica,sans-serif;font-size:15px;font-weight:600;letter-spacing:0.01em;color:#ffffff;text-decoration:none;border-radius:10px;mso-padding-alt:0;background:${bgColor};">
        <!--[if mso]><i style="letter-spacing:32px;mso-font-width:-100%;mso-text-raise:21pt;">&nbsp;</i><![endif]-->
        <span style="mso-text-raise:10pt;">${escapeHtml(label)}</span>
        <!--[if mso]><i style="letter-spacing:32px;mso-font-width:-100%;">&nbsp;</i><![endif]-->
      </a>
    </td>
  </tr>
</table>`;
}

export function renderInfoBlock(
  rows: Array<{ label: string; value: string }>
): string {
  if (rows.length === 0) return "";

  const rowsHtml = rows
    .map((row, i) => {
      const isLast = i === rows.length - 1;
      const paddingBottom = isLast ? "0" : "10px";
      return `<tr>
      <td style="padding:0 0 ${paddingBottom} 0;vertical-align:top;line-height:1.5;font-family:'DM Sans',Arial,Helvetica,sans-serif;font-size:13px;font-weight:500;color:#7A8A99;letter-spacing:0.03em;text-transform:uppercase;width:120px;">${escapeHtml(row.label)}</td>
      <td style="padding:0 0 ${paddingBottom} 0;vertical-align:top;line-height:1.5;font-family:'DM Sans',Arial,Helvetica,sans-serif;font-size:14px;font-weight:400;color:#495057;">${escapeHtml(row.value)}</td>
    </tr>`;
    })
    .join("\n");

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FAFAF7;border-radius:10px;border:1px solid rgba(26,43,60,0.05);margin-bottom:20px;">
  <tr>
    <td style="padding:20px 24px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        ${rowsHtml}
      </table>
    </td>
  </tr>
</table>`;
}

export function renderEmailTemplate(options: EmailTemplateOptions): string {
  const {
    preheaderText,
    greeting,
    bodyHtml,
    ctaButton,
    closingText,
    footerOverride
  } = options;

  const buttonHtml = ctaButton
    ? renderButton(ctaButton.label, ctaButton.url, ctaButton.style)
    : "";

  const closingHtml = closingText
    ? `<p style="margin:0 0 20px 0;font-family:'DM Sans',Arial,Helvetica,sans-serif;font-size:15px;font-weight:400;color:#495057;line-height:1.65;">${closingText}</p>`
    : "";

  const footerContent =
    footerOverride ||
    `Crew Hub by Accrue<br>Questions? Reach out to the Operations team.`;

  // Zero-width joiners to fill preheader in email clients
  const preheaderPadding = "\u200C\u00A0".repeat(80);

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
  <title>Crew Hub</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:AllowPNG/>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=Playfair+Display:wght@500;600&display=swap" rel="stylesheet">
  <style>
    /* Reset */
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    body { margin: 0; padding: 0; width: 100% !important; height: 100% !important; }
    /* iOS blue link prevention */
    a[x-apple-data-detectors] {
      color: inherit !important;
      text-decoration: none !important;
      font-size: inherit !important;
      font-family: inherit !important;
      font-weight: inherit !important;
      line-height: inherit !important;
    }
    /* Gmail blue link prevention */
    u + #body a { color: inherit; text-decoration: none; font-size: inherit; font-family: inherit; font-weight: inherit; line-height: inherit; }
    #MessageViewBody a { color: inherit; text-decoration: none; font-size: inherit; font-family: inherit; font-weight: inherit; line-height: inherit; }
    /* Mobile */
    @media only screen and (max-width: 600px) {
      .email-container { width: 100% !important; max-width: 100% !important; }
      .card-padding { padding-left: 24px !important; padding-right: 24px !important; }
      .footer-padding { padding-left: 24px !important; padding-right: 24px !important; }
      .fluid-img { width: 100% !important; max-width: 100% !important; height: auto !important; }
    }
  </style>
</head>
<body id="body" style="margin:0;padding:0;word-spacing:normal;background-color:#FFFAF3;">
  <!-- Preheader -->
  <div style="display:none;font-size:1px;color:#FFFAF3;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
    ${escapeHtml(preheaderText)}${preheaderPadding}
  </div>

  <!-- Full-width cream background wrapper -->
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#FFFAF3;">
    <tr>
      <td align="center" style="padding:40px 16px 32px 16px;">

        <!-- Content container 560px -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" class="email-container" style="max-width:560px;width:100%;">

          <!-- Brand mark -->
          <tr>
            <td align="left" style="padding-bottom:32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="36" height="36" align="center" valign="middle" style="width:36px;height:36px;background:#000000;border-radius:8px;font-family:'Playfair Display',Georgia,serif;font-size:18px;font-weight:600;color:#ffffff;text-align:center;line-height:36px;">C</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main card -->
          <tr>
            <td>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FFFFFF;border-radius:16px;border:1px solid rgba(26,43,60,0.06);box-shadow:0 1px 3px rgba(26,43,60,0.04),0 8px 24px rgba(26,43,60,0.03);">

                <!-- Orange accent bar -->
                <tr>
                  <td style="height:3px;border-radius:16px 16px 0 0;overflow:hidden;">
                    <div style="height:3px;background:linear-gradient(to right,#FD8B05 30%,transparent 100%);"></div>
                  </td>
                </tr>

                <!-- Card body -->
                <tr>
                  <td class="card-padding" style="padding:44px 44px 0 44px;">

                    <!-- Greeting -->
                    <p style="margin:0 0 24px 0;font-family:'Playfair Display',Georgia,serif;font-size:24px;font-weight:500;color:#1A2B3C;line-height:1.3;">${escapeHtml(greeting)}</p>

                    <!-- Body content -->
                    ${bodyHtml}

                    <!-- CTA Button -->
                    ${buttonHtml}

                    <!-- Closing text -->
                    ${closingHtml}

                  </td>
                </tr>

                <!-- Divider -->
                <tr>
                  <td class="card-padding" style="padding:12px 44px 0 44px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td style="border-top:1px solid rgba(232,223,208,0.6);"></td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Footer inside card -->
                <tr>
                  <td class="card-padding footer-padding" style="padding:20px 44px 36px 44px;">
                    <p style="margin:0;font-family:'DM Sans',Arial,Helvetica,sans-serif;font-size:13px;font-weight:400;color:#A0AEBA;line-height:1.6;">${footerContent}</p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <!-- Tagline below card -->
          <tr>
            <td align="center" style="padding-top:24px;">
              <p style="margin:0;font-family:'DM Sans',Arial,Helvetica,sans-serif;font-size:12px;font-weight:400;color:#C4CBCF;">Sent from Crew Hub, your team's home base.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/* ---------------------------------------------------------------------------
 * Helpers: body paragraph + conditional block
 * -------------------------------------------------------------------------*/

export function p(text: string): string {
  return `<p style="margin:0 0 20px 0;font-family:'DM Sans',Arial,Helvetica,sans-serif;font-size:15px;font-weight:400;color:#495057;line-height:1.65;">${escapeHtml(text)}</p>`;
}

export function pLast(text: string): string {
  return `<p style="margin:0 0 28px 0;font-family:'DM Sans',Arial,Helvetica,sans-serif;font-size:15px;font-weight:400;color:#495057;line-height:1.65;">${escapeHtml(text)}</p>`;
}

export function pRaw(html: string): string {
  return `<p style="margin:0 0 20px 0;font-family:'DM Sans',Arial,Helvetica,sans-serif;font-size:15px;font-weight:400;color:#495057;line-height:1.65;">${html}</p>`;
}

/* ---------------------------------------------------------------------------
 * Internal: HTML/attribute escaping
 * -------------------------------------------------------------------------*/

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
