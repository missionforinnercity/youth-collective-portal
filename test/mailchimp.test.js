const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

process.env.MailChimpAPI = "test-key-us1";
process.env.MAILCHIMP_AUDIENCE_ID = "test-audience";
const { syncSignupToMailchimp } = require("../mailchimp");

test("adds a consenting signup to the audience without sending an email", async () => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(calls.length === 1 ? { double_optin: false } : { status: "subscribed" }), { status: 200 });
  };
  try {
    assert.equal(await syncSignupToMailchimp("member@example.com", "Sam Example"), "subscribed");
    assert.deepEqual(calls.map(({ options }) => options.method || "GET"), ["GET", "PUT", "POST"]);
    assert.equal(calls[1].url.startsWith("https://us1.api.mailchimp.com/3.0/"), true);
    assert.equal(calls[1].options.redirect, "error");
    const hash = crypto.createHash("md5").update("member@example.com").digest("hex");
    assert.match(calls[1].url, new RegExp(`/lists/test-audience/members/${hash}$`));
    assert.deepEqual(JSON.parse(calls[1].options.body), {
      email_address: "member@example.com",
      status_if_new: "subscribed",
      merge_fields: { FNAME: "Sam", LNAME: "Example" },
    });
    assert.deepEqual(JSON.parse(calls[2].options.body), {
      is_syncing: true,
      tags: [{ name: "Youth Collective Website Signup", status: "active" }],
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("does not resubscribe an existing unsubscribed contact", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => new Response(
    JSON.stringify(options.method === "PUT" ? { status: "unsubscribed" } : { double_optin: false }),
    { status: 200 },
  );
  try {
    assert.equal(await syncSignupToMailchimp("member@example.com", "Sam"), "unsubscribed");
  } finally {
    global.fetch = originalFetch;
  }
});

test("does not send a confirmation email for a double opt-in audience", async () => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    calls.push(url);
    return new Response(JSON.stringify({ double_optin: true }), { status: 200 });
  };
  try {
    await assert.rejects(syncSignupToMailchimp("member@example.com", "Sam"), /double opt-in/);
    assert.equal(calls.length, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("does not add a contact when the audience opt-in setting cannot be verified", async () => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    calls.push(url);
    return new Response(JSON.stringify({}), { status: 200 });
  };
  try {
    await assert.rejects(syncSignupToMailchimp("member@example.com", "Sam"), /opt-in setting could not be verified/);
    assert.equal(calls.length, 1);
  } finally {
    global.fetch = originalFetch;
  }
});
