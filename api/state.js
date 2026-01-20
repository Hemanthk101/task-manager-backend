import mongoose from "mongoose";

// --------------------
// ✅ STEP 1: CORS + PREFLIGHT (OPTIONS)
// --------------------
function setCors(req, res) {
  const allowed = (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const origin = req.headers.origin;

  // allow requests like curl/postman (no origin)
  if (!origin) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (allowed.length === 0) {
    // if not set, allow all (not recommended for prod, but avoids blocking)
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else if (allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// --------------------
// ✅ Mongo connection caching (important for serverless)
// --------------------
let cached = global.__mongoose_cache;
if (!cached) cached = global.__mongoose_cache = { conn: null, promise: null };

async function connectMongo() {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("Missing MONGODB_URI");

    cached.promise = mongoose.connect(uri, {
      bufferCommands: false,
    });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

// --------------------
// ✅ IST Helpers
// --------------------
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

// --------------------
// ✅ Defaults
// --------------------
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

// --------------------
// ✅ Schema (includes fields your App.jsx sends)
// --------------------
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
    mindLastReminderDay: { type: Object, default: {} },

    // optional synced fields (your App.jsx is sending these)
    weightInput: { type: String, default: "" },
    muscleProgress: { type: Object, default: {} },

    istDayKey: { type: String, default: "" },
  },
  { timestamps: true }
);

const AppState =
  mongoose.models.AppState || mongoose.model("AppState", AppStateSchema);

// --------------------
// ✅ Daily reset safety (server-side)
// --------------------
function applyISTDailyReset(doc) {
  const todayIST = getISTDayKey();

  if (doc.istDayKey !== todayIST) {
    doc.bodyTasks = (doc.bodyTasks?.length ? doc.bodyTasks : defaultBodyTasks).map(
      (t) => ({ ...t, completed: false })
    );

    doc.skinTasks = (doc.skinTasks?.length ? doc.skinTasks : defaultSkinTasks).map(
      (t) => ({ ...t, completed: false })
    );

    doc.mindSubjects = (doc.mindSubjects?.length
      ? doc.mindSubjects
      : defaultMindSubjects
    ).map((s) => ({
      ...s,
      units: (s.units || []).map((u) => ({ ...u, completed: false })),
    }));

    doc.istDayKey = todayIST;
  }

  return doc;
}

// --------------------
// ✅ STEP 2: Vercel Serverless handler (GET/PUT/OPTIONS)
// --------------------
export default async function handler(req, res) {
  setCors(req, res);

  // Preflight
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  try {
    await connectMongo();

    const userId = String(req.query.userId || "demo");

    if (req.method === "GET") {
      let doc = await AppState.findOne({ userId });

      if (!doc) {
        doc = await AppState.create({
          userId,
          plannerTasks: [],
          bodyTasks: defaultBodyTasks,
          skinTasks: defaultSkinTasks,
          skinSessions: 0,
          mindSubjects: defaultMindSubjects,
          reminderSettings: { enabled: true, skinTime: "21:00", bodyTime: "19:00" },
          istDayKey: getISTDayKey(),
        });
      }

      doc = applyISTDailyReset(doc);
      await doc.save();

      return res.status(200).json(doc.toObject());
    }

    if (req.method === "PUT") {
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
      doc.mindLastReminderDay = payload.mindLastReminderDay ?? doc.mindLastReminderDay;

      doc.weightInput = payload.weightInput ?? doc.weightInput;
      doc.muscleProgress = payload.muscleProgress ?? doc.muscleProgress;

      await doc.save();

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    return res.status(500).json({ error: "Server error", details: String(e) });
  }
}
