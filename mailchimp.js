const crypto = require("crypto");

const apiKey = (process.env.MailChimpAPI || process.env.MAILCHIMP_API_KEY || "").trim();
const audienceId = (process.env.MAILCHIMP_AUDIENCE_ID || "").trim();
const signupTag = (process.env.MAILCHIMP_SIGNUP_TAG || "Youth Collective Website Signup").trim();
const dataCenter = apiKey.match(/-([a-z0-9]+)$/i)?.[1];

function isConfigured() {
  return Boolean(apiKey && audienceId && signupTag && dataCenter);
}

async function mailchimpRequest(path, options = {}) {
  const response = await fetch(`https://${dataCenter}.api.mailchimp.com/3.0${path}`, {
    ...options,
    headers: {
      Authorization: `Basic ${Buffer.from(`youth-collective:${apiKey}`).toString("base64")}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Mailchimp returned HTTP ${response.status}.`);
  return response.status === 204 ? null : response.json();
}

async function syncSignupToMailchimp(email, name) {
  if (!isConfigured()) throw new Error("Mailchimp signup configuration is incomplete.");

  // Pending would send a confirmation email; this integration only uses single opt-in audiences.
  const audience = await mailchimpRequest(`/lists/${encodeURIComponent(audienceId)}?fields=double_optin`);
  if (audience?.double_optin === true) {
    throw new Error("Mailchimp audience uses double opt-in, which would require a confirmation email.");
  }
  if (audience?.double_optin !== false) throw new Error("Mailchimp audience opt-in setting could not be verified.");

  const hash = crypto.createHash("md5").update(email.toLowerCase()).digest("hex");
  const memberPath = `/lists/${encodeURIComponent(audienceId)}/members/${hash}`;
  const [firstName, ...lastName] = name.trim().split(/\s+/);
  const member = await mailchimpRequest(memberPath, {
    method: "PUT",
    body: JSON.stringify({
      email_address: email,
      status_if_new: "subscribed",
      merge_fields: { FNAME: firstName, ...(lastName.length ? { LNAME: lastName.join(" ") } : {}) },
    }),
  });

  // status_if_new leaves existing unsubscribed or cleaned contacts untouched.
  if (!["subscribed", "unsubscribed", "cleaned", "pending", "transactional"].includes(member?.status)) {
    throw new Error("Mailchimp returned an unrecognized member status.");
  }
  if (member.status === "subscribed") {
    await mailchimpRequest(`${memberPath}/tags`, {
      method: "POST",
      body: JSON.stringify({
        is_syncing: true,
        tags: [{ name: signupTag, status: "active" }],
      }),
    });
  }
  return member.status;
}

module.exports = { isConfigured, syncSignupToMailchimp };
