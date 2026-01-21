import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const app = express();
app.use(express.json());

// ✅ STEP 1: FIX CORS + PREFLIGHT (OPTIONS)
const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const corsOptions = {
  origin: (origin, cb) => {
    // allow curl/postman (no origin header)
    if (!origin) return cb(null, true);

    // if CORS_ORIGIN not set, allow all (NOT recommended for prod)
    if (allowedOrigins.length === 0) return cb(null, true);

    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error("Not allowed by CORS: " + origin));
  },
  methods: ["GET", "PUT", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: false, // keep false unless you use cookies
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // ✅ fixes preflight

// ---------- IST Helpers ----------
function getISTDayKey() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const y = parts.find((p) => p.type === "year")?.value || "0000";
  const m = parts.find((p) => p.type === "month")?.value || "00";
  const d = parts.find((p) => p.type === "day")?.value || "00";
  return `${y}-${m}-${d}`;
}

// ---------- Schema ----------
const AppStateSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true },

    plannerTasks: { type: Array, default: [] },
    bodyTasks: { type: Array, default: [] },
    skinTasks: { type: Array, default: [] },
    skinSessions: { type: Number, default: 0 },
    mindSubjects: { type: Array, default: [] },

    reminderSettings: {
      type: Object,
      default: { enabled: true, skinTime: "21:00", bodyTime: "19:00" },
    },
    mindReminderTimes: { type: Object, default: {} },
    mindReminderEnabled: { type: Object, default: {} },

    istDayKey: { type: String, default: "" },
  },
  { timestamps: true }
);

const AppState = mongoose.models.AppState || mongoose.model("AppState", AppStateSchema);

// ---------- Defaults ----------
const defaultBodyTasks = [
  { id: 1, label: "Push ups", completed: false },
  { id: 2, label: "Pull ups", completed: false },
  { id: 3, label: "Crunches", completed: false },
  { id: 4, label: "Crucifix", completed: false },
  { id: 5, label: "Russian Twists", completed: false },
  { id: 6, label: "Biceps", completed: false },
  { id: 7, label: "Shoulders", completed: false },
  { id: 8, label: "Triceps", completed: false },
  { id: 9, label: "Forearms", completed: false },
  { id: 10, label: "Calisthenics", completed: false },
];

const defaultSkinTasks = [
  { id: 1, label: "Body Wash", completed: false },
  { id: 2, label: "Face Wash", completed: false },
  { id: 3, label: "Clean", completed: false },
  { id: 4, label: "Face Serum", completed: false },
  { id: 5, label: "Eye Blow Cleaning", completed: false },
];

const defaultMindSubjects = [
  {
    id: "dsa",
    label: "DSA",
    units: [
      { id: "dsa-u1", label: "U1", completed: false },
      { id: "dsa-u2", label: "U2", completed: false },
      { id: "dsa-u3", label: "U3", completed: false },
      { id: "dsa-u4", label: "U4", completed: false },
    ],
    links: [],
  },
];

// ---------- Daily Reset ----------
function applyISTDailyReset(doc) {
  const todayIST = getISTDayKey();

  if (doc.istDayKey !== todayIST) {
    doc.bodyTasks = (doc.bodyTasks?.length ? doc.bodyTasks : defaultBodyTasks).map((t) => ({
      ...t,
      completed: false,
    }));

    doc.skinTasks = (doc.skinTasks?.length ? doc.skinTasks : defaultSkinTasks).map((t) => ({
      ...t,
      completed: false,
    }));

    doc.mindSubjects = (doc.mindSubjects?.length ? doc.mindSubjects : defaultMindSubjects).map((s) => ({
      ...s,
      units: (s.units || []).map((u) => ({ ...u, completed: false })),
    }));

    doc.istDayKey = todayIST;
  }
  return doc;
}

// ---------- DB connect (cached for serverless) ----------
let cached = globalThis.__MONGO_CONN__;
if (!cached) cached = globalThis.__MONGO_CONN__ = { conn: null, promise: null };

async function connectDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("Missing MONGODB_URI");

  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    cached.promise = mongoose.connect(uri).then((m) => m);
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

// ---------- Routes ----------
app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "Task Manager Backend is running",
    endpoints: ["/health", "/api/state?userId=demo"],
  });
});

app.get("/health", (req, res) => res.json({ ok: true }));

app.get("/api/state", async (req, res) => {
  try {
    await connectDb();

    const userId = String(req.query.userId || "demo");
    let doc = await AppState.findOne({ userId });

    if (!doc) {
      doc = await AppState.create({
        userId,
        plannerTasks: [],
        bodyTasks: defaultBodyTasks,
        skinTasks: defaultSkinTasks,
        skinSessions: 0,
        mindSubjects: defaultMindSubjects,
        istDayKey: getISTDayKey(),
      });
    }

    doc = applyISTDailyReset(doc);
    await doc.save();

    res.json(doc);
  } catch (e) {
    res.status(500).json({ error: "Failed to load state", details: String(e) });
  }
});

app.put("/api/state", async (req, res) => {
  try {
    await connectDb();

    const userId = String(req.query.userId || "demo");
    const payload = req.body || {};

    let doc = await AppState.findOne({ userId });
    if (!doc) doc = new AppState({ userId });

    doc = applyISTDailyReset(doc);

    doc.plannerTasks = payload.plannerTasks ?? doc.plannerTasks;
    doc.bodyTasks = payload.bodyTasks ?? doc.bodyTasks;
    doc.skinTasks = payload.skinTasks ?? doc.skinTasks;
    doc.skinSessions = payload.skinSessions ?? doc.skinSessions;
    doc.mindSubjects = payload.mindSubjects ?? doc.mindSubjects;

    doc.reminderSettings = payload.reminderSettings ?? doc.reminderSettings;
    doc.mindReminderTimes = payload.mindReminderTimes ?? doc.mindReminderTimes;
    doc.mindReminderEnabled = payload.mindReminderEnabled ?? doc.mindReminderEnabled;

    await doc.save();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Failed to save state", details: String(e) });
  }
});

// ✅ STEP 2: Vercel serverless export + keep local run working
const isVercel = !!process.env.VERCEL;

// Local run: npm start
if (!isVercel) {
  connectDb()
    .then(() => {
      const port = Number(process.env.PORT || 8080);
      app.listen(port, () => console.log(`API running on :${port}`));
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

// Vercel: serverless handler
export default async function handler(req, res) {
  await connectDb();
  return app(req, res);
}
