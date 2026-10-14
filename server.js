require("dotenv").config();

const express = require("express");
const { MongoClient } = require("mongodb");
const crypto = require("crypto");
const path = require("path");

const app = express();
const port = Number(process.env.PORT || 3000);
const databaseName = process.env.MONGODB_DATABASE || "youth_collective";
const collectionNames = {
  surveys: process.env.MONGODB_SURVEYS_COLLECTION || "surveys",
  members: process.env.MONGODB_MEMBERS_COLLECTION || "members",
  spaces: process.env.MONGODB_SPACES_COLLECTION || "third_spaces",
  questions: process.env.MONGODB_QUESTIONS_COLLECTION || "survey_questions",
};
const defaultQuestions = [
  "How do you travel coming into the Inner City?",
  "How do you move around in the Inner City?",
  "Where do you spend more time when you are in the Inner City?",
  "Do you feel like you belong in the Inner City?",
  "Where do you feel like you belong?",
  "What makes a space welcoming for you in the Inner City?",
  "What space in the Inner City represents you?",
  "What challenges do you experience when you are in the Inner City?",
  "What would you like to see change in the Inner City?",
  "What opportunities already exist in the Inner City?",
  "How, if at all, do you earn money in the Inner City?",
].map((text, index) => ({ id: `q${index + 1}`, text }));

app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(__dirname, "public")));

let db;
let mongoClient;
let mongoConnecting;
let mongoHealthCheck;
let mongoReconnectTimer;
let mongoHealthTimer;
let mongoRetryDelay = 1000;
let shuttingDown = false;
const failedAdminLogins = new Map();

function mongoConnectionString() {
  let uri = (process.env.MONGODB_URI || "").trim().replace(/^['"]|['"]$/g, "");
  if (!uri) throw new Error("MONGODB_URI is missing.");
  if (!/^mongodb(?:\+srv)?:\/\//i.test(uri)) uri = `mongodb+srv://${uri}`;

  const parsed = new URL(uri);
  if (process.env.MONGODB_USERNAME && !parsed.username) {
    parsed.username = process.env.MONGODB_USERNAME;
    parsed.password = process.env.MONGODB_PASSWORD || "";
  }
  if (!parsed.pathname || parsed.pathname === "/") parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

function cleanText(value, maxLength = 1000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function requireDb(res) {
  if (db) return true;
  scheduleMongoReconnect();
  res.status(503).json({ error: "The survey is temporarily unavailable. Please try again shortly." });
  return false;
}

function scheduleMongoReconnect() {
  if (shuttingDown || mongoReconnectTimer || mongoConnecting) return;
  const delay = mongoRetryDelay;
  mongoRetryDelay = Math.min(mongoRetryDelay * 2, 30000);
  mongoReconnectTimer = setTimeout(() => {
    mongoReconnectTimer = null;
    void connectMongo();
  }, delay);
  mongoReconnectTimer.unref();
}

function mongoConnectionErrorDetails(error) {
  const summary = String(error.cause?.message || error.message).split("\n")[0].slice(0, 180);
  const servers = [...(error.reason?.servers?.values?.() || [])]
    .map((server) => {
      const issue = server.error;
      return issue
        ? `${server.address}: ${issue.name || "connection error"}: ${String(issue.message || "").split("\n")[0].slice(0, 180)}`
        : `${server.address}: ${server.type || "unavailable"}`;
    })
    .slice(0, 10);
  return servers.length ? `${summary}; servers: ${servers.join(" | ")}` : summary;
}

function connectMongo() {
  if (mongoConnecting || shuttingDown) return mongoConnecting;
  mongoConnecting = (async () => {
    let client;
    try {
      client = new MongoClient(mongoConnectionString(), {
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000,
        maxPoolSize: 20,
        minPoolSize: 0,
        retryReads: true,
        retryWrites: true,
      });
      await client.connect();
      const connectedDb = client.db(databaseName);
      await connectedDb.command({ ping: 1 });
      if (shuttingDown) {
        await client.close();
        return;
      }
      mongoClient = client;
      db = connectedDb;
      mongoRetryDelay = 1000;
      console.log(`Connected to MongoDB database: ${databaseName}`);
    } catch (error) {
      await client?.close().catch(() => {});
      const delaySeconds = Math.ceil(mongoRetryDelay / 1000);
      const details = mongoConnectionErrorDetails(error);
      console.error(`MongoDB connection failed (${error.name}): ${details}. Retrying in ${delaySeconds}s.`);
    }
  })().finally(() => {
    mongoConnecting = null;
    if (!db && !mongoReconnectTimer && !shuttingDown) scheduleMongoReconnect();
  });
  return mongoConnecting;
}

async function verifyMongoConnection() {
  if (mongoHealthCheck) return mongoHealthCheck;
  if (!db || !mongoClient || mongoConnecting || shuttingDown) return false;
  mongoHealthCheck = (async () => {
    try {
      await db.command({ ping: 1 });
      return true;
    } catch (error) {
      console.error(`MongoDB health check failed (${error.name}); reconnecting.`);
      const staleClient = mongoClient;
      mongoClient = null;
      db = null;
      if (staleClient) await staleClient.close().catch(() => {});
      scheduleMongoReconnect();
      return false;
    }
  })().finally(() => { mongoHealthCheck = null; });
  return mongoHealthCheck;
}

function monitorMongoConnection() {
  if (mongoHealthTimer) return;
  mongoHealthTimer = setInterval(() => { void verifyMongoConnection(); }, 30000);
  mongoHealthTimer.unref();
}

function sessionToken(expiresAt) {
  const signature = crypto.createHmac("sha256", process.env.ADMIN_PASSWORD).update(`youth-collective-admin:${expiresAt}`).digest("base64url");
  return `${expiresAt}.${signature}`;
}

function isAdmin(req) {
  const token = (req.headers.cookie || "").split(";").map((item) => item.trim()).find((item) => item.startsWith("yc_admin="))?.slice("yc_admin=".length);
  const [expiryText, signature] = (token || "").split(".");
  const expiry = Number(expiryText);
  if (!Number.isFinite(expiry) || expiry < Date.now() || !signature || !process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12) return false;
  const expected = sessionToken(expiry).split(".")[1];
  const suppliedHash = crypto.createHash("sha256").update(signature).digest();
  const expectedHash = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(suppliedHash, expectedHash);
}

function requireAdmin(req, res) {
  if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12) {
    res.status(503).json({ error: "Admin access is disabled. Set ADMIN_PASSWORD to at least 12 characters in .env." });
    return false;
  }
  if (!isAdmin(req)) {
    res.status(401).json({ error: "Please sign in as an administrator." });
    return false;
  }
  return true;
}

async function getActiveQuestions() {
  let questions = await db.collection(collectionNames.questions).find({ active: { $ne: false } }).sort({ order: 1 }).toArray();
  if (!questions.length) {
    await db.collection(collectionNames.questions).insertMany(defaultQuestions.map((question, order) => ({ ...question, order, active: true, updatedAt: new Date() })));
    questions = await db.collection(collectionNames.questions).find({ active: { $ne: false } }).sort({ order: 1 }).toArray();
  }
  return questions.map(({ id, text }) => ({ id, text }));
}

function adminCookie(token, maxAge) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `yc_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}

app.get("/api/config", (_req, res) => {
  res.json({
    city: process.env.CITY_NAME || "Cape Town CBD",
    center: [Number(process.env.CITY_LAT || -33.9249), Number(process.env.CITY_LNG || 18.4241)],
  });
});

app.get("/api/admin/status", (req, res) => {
  const enabled = Boolean(process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length >= 12);
  res.json({ enabled, authenticated: enabled && isAdmin(req) });
});

app.post("/api/admin/login", (req, res) => {
  const password = process.env.ADMIN_PASSWORD || "";
  if (password.length < 12) return res.status(503).json({ error: "Set ADMIN_PASSWORD to at least 12 characters in .env before signing in." });
  const address = req.ip || req.socket.remoteAddress || "unknown";
  const attempt = failedAdminLogins.get(address);
  if (attempt && attempt.resetAt > Date.now() && attempt.count >= 5) {
    return res.status(429).json({ error: "Too many sign-in attempts. Wait 15 minutes and try again." });
  }
  const provided = typeof req.body?.password === "string" ? req.body.password : "";
  const providedHash = crypto.createHash("sha256").update(provided).digest();
  const expectedHash = crypto.createHash("sha256").update(password).digest();
  if (!crypto.timingSafeEqual(providedHash, expectedHash)) {
    const count = attempt?.resetAt > Date.now() ? attempt.count + 1 : 1;
    failedAdminLogins.set(address, { count, resetAt: Date.now() + 15 * 60_000 });
    return res.status(401).json({ error: "That password did not match." });
  }
  failedAdminLogins.delete(address);
  const expiresAt = Date.now() + 8 * 60 * 60_000;
  res.setHeader("Set-Cookie", adminCookie(sessionToken(expiresAt), 8 * 60 * 60));
  res.json({ authenticated: true });
});

app.post("/api/admin/logout", (_req, res) => {
  res.setHeader("Set-Cookie", adminCookie("", 0));
  res.json({ authenticated: false });
});

app.get("/api/questions", async (_req, res) => {
  if (!requireDb(res)) return;
  try { res.json(await getActiveQuestions()); }
  catch (error) {
    console.error("Question list failed:", error.message);
    res.status(500).json({ error: "We couldn't load the survey questions right now." });
  }
});

app.get("/api/health", async (_req, res) => {
  const ready = await verifyMongoConnection();
  if (!ready) scheduleMongoReconnect();
  res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "reconnecting" });
});

app.post("/api/surveys", async (req, res) => {
  if (!requireDb(res)) return;
  const answers = req.body?.answers;
  const consent = req.body?.consent === true;
  if (!consent) return res.status(400).json({ error: "Please agree to share your answers with Youth Collective." });
  const respondent = {
    firstName: cleanText(req.body?.firstName, 100),
    lastName: cleanText(req.body?.lastName, 100),
    thirdSpace: cleanText(req.body?.thirdSpace, 160),
  };
  if (!respondent.firstName || !respondent.lastName || !respondent.thirdSpace) {
    return res.status(400).json({ error: "Please add your name, surname, and third space." });
  }
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    return res.status(400).json({ error: "Survey answers are missing." });
  }
  try {
    const questions = await getActiveQuestions();
    const sanitizedAnswers = Object.fromEntries(questions.map((question) => [question.id, cleanText(answers[question.id], 1000)]));
    if (!sanitizedAnswers[questions[0].id]) return res.status(400).json({ error: "Please answer the first question." });
    await db.collection(collectionNames.surveys).insertOne({
      respondent,
      answers: sanitizedAnswers,
      questionLabels: Object.fromEntries(questions.map(({ id, text }) => [id, text])),
      createdAt: new Date(),
    });
    res.status(201).json({ message: "Thanks for sharing your voice!" });
  } catch (error) {
    console.error("Survey save failed:", error.message);
    res.status(500).json({ error: "We couldn't save your answers right now." });
  }
});

app.post("/api/members", async (req, res) => {
  if (!requireDb(res)) return;
  const name = cleanText(req.body?.name, 120);
  const email = cleanText(req.body?.email, 254).toLowerCase();
  if (!name) return res.status(400).json({ error: "Enter your name." });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (req.body?.consent !== true) return res.status(400).json({ error: "Please agree to be contacted by Youth Collective." });

  try {
    await db.collection(collectionNames.members).insertOne({ name, email, createdAt: new Date() });
    res.status(201).json({ message: "You're on the list. Youth Collective will be in touch!" });
  } catch (error) {
    console.error("Member signup save failed:", error.message);
    res.status(500).json({ error: "We couldn't save your sign-up right now." });
  }
});

app.get("/api/spaces", async (_req, res) => {
  if (!requireDb(res)) return;
  try {
    const spaces = await db.collection(collectionNames.spaces)
      .find({}, { projection: { name: 1, description: 1, address: 1, latitude: 1, longitude: 1, cost: 1, createdAt: 1 } })
      .sort({ name: 1 }).limit(500).toArray();
    res.json(spaces.map((space) => ({ ...space, id: space._id.toString(), _id: undefined })));
  } catch (error) {
    console.error("Space list failed:", error.message);
    res.status(500).json({ error: "We couldn't load the spaces right now." });
  }
});

function validateSpace(body) {
  const space = {
    name: cleanText(body?.name, 120),
    address: cleanText(body?.address, 240),
    description: cleanText(body?.description, 500),
    cost: cleanText(body?.cost, 120),
    latitude: Number(body?.latitude),
    longitude: Number(body?.longitude),
  };
  if (!space.name || !space.address || !Number.isFinite(space.latitude) || !Number.isFinite(space.longitude) || Math.abs(space.latitude) > 90 || Math.abs(space.longitude) > 180) return null;
  return space;
}

app.get("/api/admin/responses", async (req, res) => {
  if (!requireAdmin(req, res) || !requireDb(res)) return;
  try {
    const [questions, docs, count] = await Promise.all([
      db.collection(collectionNames.questions).find({}).toArray(),
      db.collection(collectionNames.surveys).find({}).sort({ createdAt: -1 }).limit(500).toArray(),
      db.collection(collectionNames.surveys).countDocuments(),
    ]);
    const labels = new Map(defaultQuestions.map(({ id, text }) => [id, text]));
    for (const question of questions) labels.set(question.id, question.text);
    const responses = docs.map((doc) => ({
      id: doc._id.toString(),
      createdAt: doc.createdAt,
      respondent: doc.respondent || null,
      answers: Object.entries(doc.answers || {}).map(([id, answer]) => ({
        question: doc.questionLabels?.[id] || labels.get(id) || `Previous question (${id})`,
        answer,
      })).filter((entry) => entry.answer),
    }));
    res.json({ count, responses });
  } catch (error) {
    console.error("Admin response list failed:", error.message);
    res.status(500).json({ error: "We couldn't load responses right now." });
  }
});

app.put("/api/admin/questions", async (req, res) => {
  if (!requireAdmin(req, res) || !requireDb(res)) return;
  const questions = req.body?.questions;
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > 25) return res.status(400).json({ error: "Keep between 1 and 25 active questions." });
  const normalized = questions.map((item) => ({ id: cleanText(item?.id, 80), text: cleanText(item?.text, 300) }));
  if (normalized.some(({ id, text }) => !/^[a-zA-Z0-9_-]+$/.test(id) || !text) || new Set(normalized.map((item) => item.id)).size !== normalized.length) {
    return res.status(400).json({ error: "Each question needs unique text and an ID." });
  }
  try {
    const collection = db.collection(collectionNames.questions);
    await collection.updateMany({ active: { $ne: false } }, { $set: { active: false, updatedAt: new Date() } });
    await Promise.all(normalized.map((question, order) => collection.updateOne(
      { id: question.id },
      { $set: { ...question, order, active: true, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true },
    )));
    res.json({ questions: normalized, message: "Survey questions saved." });
  } catch (error) {
    console.error("Question update failed:", error.message);
    res.status(500).json({ error: "We couldn't save the questions right now." });
  }
});

app.post("/api/admin/spaces", async (req, res) => {
  if (!requireAdmin(req, res) || !requireDb(res)) return;
  const space = validateSpace(req.body);
  if (!space) return res.status(400).json({ error: "Add a name, address, and valid map coordinates." });
  try {
    const result = await db.collection(collectionNames.spaces).insertOne({ ...space, createdAt: new Date() });
    res.status(201).json({ id: result.insertedId.toString(), message: "Space added to the map." });
  } catch (error) {
    console.error("Admin space save failed:", error.message);
    res.status(500).json({ error: "We couldn't add this space right now." });
  }
});

app.put("/api/admin/spaces/:id", async (req, res) => {
  if (!requireAdmin(req, res) || !requireDb(res)) return;
  const space = validateSpace(req.body);
  if (!space) return res.status(400).json({ error: "Add a name, address, and valid map coordinates." });
  if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.status(400).json({ error: "Invalid space ID." });
  try {
    const { ObjectId } = require("mongodb");
    const result = await db.collection(collectionNames.spaces).updateOne({ _id: new ObjectId(req.params.id) }, { $set: { ...space, updatedAt: new Date() } });
    if (!result.matchedCount) return res.status(404).json({ error: "Space not found." });
    res.json({ message: "Space updated." });
  } catch (error) {
    console.error("Admin space update failed:", error.message);
    res.status(500).json({ error: "We couldn't update this space right now." });
  }
});

app.delete("/api/admin/spaces/:id", async (req, res) => {
  if (!requireAdmin(req, res) || !requireDb(res)) return;
  if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.status(400).json({ error: "Invalid space ID." });
  try {
    const { ObjectId } = require("mongodb");
    const result = await db.collection(collectionNames.spaces).deleteOne({ _id: new ObjectId(req.params.id) });
    if (!result.deletedCount) return res.status(404).json({ error: "Space not found." });
    res.json({ message: "Space removed from the map." });
  } catch (error) {
    console.error("Admin space delete failed:", error.message);
    res.status(500).json({ error: "We couldn't remove this space right now." });
  }
});
app.get("/{*splat}", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

function start() {
  app.listen(port, () => {
    console.log(`Youth Collective portal running at http://localhost:${port}`);
    monitorMongoConnection();
    void connectMongo();
  });
}

start();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    shuttingDown = true;
    if (mongoReconnectTimer) clearTimeout(mongoReconnectTimer);
    if (mongoHealthTimer) clearInterval(mongoHealthTimer);
    if (mongoClient) await mongoClient.close();
    process.exit(0);
  });
}
