const { RESEND_API_KEY, EMAIL_FROM } = require("./config");

function isConfigured() {
  return !!RESEND_API_KEY;
}

// Falls back to a console log when Resend isn't configured yet, so the
// whole login flow is testable locally before an email provider exists.
async function sendVerificationCode(email, code) {
  if (!isConfigured()) {
    console.log(`[email:dev] verification code for ${email}: ${code}`);
    return { delivered: false, dev: true };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: email,
      subject: `${code} is your Bumper verification code`,
      text: `Your Bumper verification code is ${code}. It expires in 10 minutes.`,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend send failed (${res.status}): ${body}`);
  }
  return { delivered: true };
}

module.exports = { isConfigured, sendVerificationCode };
