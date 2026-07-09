/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import * as functions from "firebase-functions/v1";
import {HttpsError} from "firebase-functions/v1/https";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import * as admin from "firebase-admin";

// Start writing functions
// https://firebase.google.com/docs/functions/typescript

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
// NOTE: This file uses 1st Gen callable functions to avoid unsupported
// in-place upgrades from 1st Gen to 2nd Gen.

const getGeminiApiKey = (): string => {
  const fromEnv = process.env.GEMINI_API_KEY;
  if (fromEnv && String(fromEnv).trim()) return String(fromEnv).trim();

  const fromConfig = (functions as any).config?.()?.gemini?.key;
  if (fromConfig && String(fromConfig).trim()) return String(fromConfig).trim();

  return "";
};

// export const helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});

const getFirebaseAdminApp = (): admin.app.App => {
  if (admin.apps.length) return admin.app();
  return admin.initializeApp();
};

const verifyFirebaseIdToken = async (req: Request): Promise<admin.auth.DecodedIdToken | null> => {
  const authHeader = String(req.headers.authorization || "");
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return null;

  try {
    const app = getFirebaseAdminApp();
    return await app.auth().verifyIdToken(token);
  } catch {
    return null;
  }
};

const requireAdmin = async (decoded: admin.auth.DecodedIdToken): Promise<boolean> => {
  const app = getFirebaseAdminApp();
  const db = app.firestore();

  const uid = String(decoded.uid || "").trim();
  if (!uid) return false;

  const userDoc = await db.collection("users").doc(uid).get();
  const userType = String(userDoc.exists ? (userDoc.data() as any)?.userType : decoded.userType || "");
  return userType === "admin" || userType === "school";
};

const apiApp = express();
apiApp.use(cors({ origin: true }));
apiApp.use(express.json({ limit: "2mb" }));

// Strip /api prefix from request path (Hosting rewrite passes full path)
apiApp.use((req: Request, _res: Response, next: NextFunction) => {
  if (req.url.startsWith("/api")) {
    req.url = req.url.slice(4) || "/";
  }
  next();
});

apiApp.get("/health", (_req, res) => {
  res.json({ success: true, timestamp: Date.now() });
});

apiApp.use(async (req: Request, res: Response, next: NextFunction) => {
  // Public endpoints (no auth required)
  if (req.method === "GET" && req.path === "/admin/roster/check-teacher-id") {
    next();
    return;
  }

  const decoded = await verifyFirebaseIdToken(req);
  if (!decoded) {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return;
  }

  (req as any).user = decoded;
  next();
});

// --- Admin routes ---
apiApp.get("/admin/metrics/dashboard", async (req: Request, res: Response) => {
  try {
    const decoded = (req as any).user as admin.auth.DecodedIdToken;
    if (!(await requireAdmin(decoded))) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    const startedAt = Date.now();
    const app = getFirebaseAdminApp();
    const db = app.firestore();
    const cacheRef = db.collection("dashboard").doc("summary");

    const cached = await cacheRef.get().catch(() => null);
    const cacheData = cached?.exists ? (cached.data() as any) : null;
    const cacheExpires = Number(cacheData?.cachedUntil || 0);
    if (cacheExpires > Date.now() && cacheData?.payload) {
      return res.json({ success: true, data: cacheData.payload, cached: true });
    }

    const getCountValue = async (query: admin.firestore.Query): Promise<number> => {
      try {
        const snap = await query.count().get();
        return Number((snap.data() as any)?.count || 0);
      } catch {
        const snap = await query.get();
        return snap.size;
      }
    };

    const toMilliseconds = (value: any): number => {
      if (typeof value === 'number') return value;
      if (typeof value === 'string' && !Number.isNaN(Number(value))) return Number(value);
      if (value && typeof value.toMillis === 'function') return Number(value.toMillis());
      if (value && typeof value.seconds === 'number') {
        return value.seconds * 1000 + Number(value.nanoseconds || 0) / 1_000_000;
      }
      return NaN;
    };

    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    const weekStart = midnight - 6 * dayMs;
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const [
      totalUsers,
      teachersCount,
      adminsCount,
      totalClasses
    ] = await Promise.all([
      getCountValue(db.collection("users")),
      getCountValue(db.collection("users").where("userType", "==", "teacher")),
      getCountValue(db.collection("users").where("userType", "in", ["admin", "school"])),
      getCountValue(db.collectionGroup("classes"))
    ]);

    const resultsSnap = await db.collectionGroup("results").get().catch(() => null);
    const totalScannedPapers = resultsSnap ? resultsSnap.size : 0;

    let questionsGeneratedToday = 0;
    const questionsByDay: { day: string; count: number }[] = [];
    const dailyQuestionCounts = Array.from({ length: 7 }, () => 0);

    const subjectsSnap = await db.collectionGroup("subjects").get().catch(() => null);
    if (subjectsSnap) {
      subjectsSnap.forEach((doc) => {
        const data = doc.data() || {};
        const updatedAt = toMilliseconds((data as any).questionsUpdatedAt);
        if (!Number.isFinite(updatedAt) || updatedAt < weekStart || updatedAt >= midnight + dayMs) {
          return;
        }

        const list = Array.isArray((data as any).questions) ? (data as any).questions : [];
        const bucket = Math.floor((updatedAt - weekStart) / dayMs);
        if (bucket >= 0 && bucket < 7) {
          dailyQuestionCounts[bucket] += list.length;
        }
      });
    }

    for (let i = 0; i < 7; i += 1) {
      const dayDate = new Date(weekStart + i * dayMs);
      questionsByDay.push({
        day: dayNames[dayDate.getDay()],
        count: dailyQuestionCounts[i]
      });
    }

    questionsGeneratedToday = dailyQuestionCounts[6];

    const scansByClass: { className: string; count: number }[] = [];
    const classScanCounts: Record<string, number> = {};
    const weeklyActivity: { day: string; scans: number }[] = [];

    if (resultsSnap) {
      resultsSnap.docs.forEach((doc) => {
        const data = doc.data() || {};
        const createdAt = Number((data as any).createdAt || (data as any).scannedAt || 0);
        const className = String((data as any).className || (data as any).classId || 'Unknown');

        if (createdAt >= weekStart && createdAt < midnight + dayMs) {
          const bucket = Math.floor((createdAt - weekStart) / dayMs);
          if (bucket >= 0 && bucket < 7) {
            dailyQuestionCounts[bucket] = dailyQuestionCounts[bucket];
          }
        }

        classScanCounts[className] = (classScanCounts[className] || 0) + 1;
      });

      for (let i = 0; i < 7; i += 1) {
        const dayStart = weekStart + i * dayMs;
        const dayDate = new Date(dayStart);
        const dayName = dayNames[dayDate.getDay()];
        const scansForDay = resultsSnap.docs.reduce((count, doc) => {
          const data = doc.data() || {};
          const createdAt = Number((data as any).createdAt || (data as any).scannedAt || 0);
          return count + ((createdAt >= dayStart && createdAt < dayStart + dayMs) ? 1 : 0);
        }, 0);
        weeklyActivity.push({ day: dayName, scans: scansForDay });
      }
    }

    Object.entries(classScanCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .forEach(([className, count]) => {
        scansByClass.push({ className, count });
      });

    if (scansByClass.length === 0) {
      scansByClass.push({ className: 'No Data', count: 0 });
    }

    const responseData = {
      totalUsers,
      totalTeachers: teachersCount,
      totalAdmins: adminsCount,
      totalClasses,
      totalScannedPapers,
      questionsGeneratedToday,
      weeklyActivity,
      scansByClass,
      questionsByDay,
      computedAt: new Date().toISOString(),
      responseTimeMs: Date.now() - startedAt
    };

    await cacheRef.set({
      cachedUntil: Date.now() + 30_000,
      payload: responseData
    }, { merge: true });

    return res.json({ success: true, data: responseData, cached: false });
  } catch (err: any) {
    console.error("api/admin/metrics/dashboard error:", err);
    return res.status(500).json({ success: false, error: "Failed to load dashboard metrics", message: err?.message });
  }
});

apiApp.get("/admin/users", async (req: Request, res: Response) => {
  try {
    const decoded = (req as any).user as admin.auth.DecodedIdToken;
    if (!(await requireAdmin(decoded))) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "10"), 10) || 10));
    const search = String(req.query.search || "").trim().toLowerCase();

    const app = getFirebaseAdminApp();
    const db = app.firestore();
    const usersSnap = await db.collection("users").get();

    let allUsers = usersSnap.docs.map((doc) => {
      const data = doc.data() || {};
      const userType = (data as any).userType;
      return {
        id: doc.id,
        email: String((data as any).email ?? ""),
        name: String((data as any).name ?? ""),
        userType: userType === "admin" || userType === "school" || userType === "teacher" ? userType : "teacher",
        schoolName: (data as any).schoolName ?? null,
        schoolId: (data as any).schoolId ?? null,
        createdAt: (data as any).createdAt ?? null
      };
    });

    if (search) {
      allUsers = allUsers.filter((u) => {
        return (u.name || "").toLowerCase().includes(search) ||
          (u.email || "").toLowerCase().includes(search) ||
          (u.userType || "").toLowerCase().includes(search) ||
          (u.schoolName || "").toLowerCase().includes(search);
      });
    }

    const total = allUsers.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const users = allUsers.slice(start, start + limit);

    return res.json({
      success: true,
      data: {
        users,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      }
    });
  } catch (err: any) {
    console.error("api/admin/users list error:", err);
    return res.status(500).json({ success: false, error: "Failed to list users", message: err?.message });
  }
});

apiApp.put("/admin/users/:uid", async (req: Request, res: Response) => {
  try {
    const decoded = (req as any).user as admin.auth.DecodedIdToken;
    if (!(await requireAdmin(decoded))) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    const uid = String(req.params.uid || "").trim();
    if (!uid) {
      return res.status(400).json({ success: false, error: "uid is required" });
    }

    const { name, email, userType, schoolName, schoolId } = req.body || {};
    const updates: any = {};
    if (typeof name === "string") updates.name = name.trim();
    if (typeof email === "string" && email.trim()) updates.email = email.trim();
    if (userType === "teacher" || userType === "admin" || userType === "school") updates.userType = userType;
    if (schoolName !== undefined) updates.schoolName = schoolName || null;
    if (schoolId !== undefined) updates.schoolId = schoolId || null;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, error: "No valid fields to update" });
    }

    updates.updatedAt = Date.now();

    const app = getFirebaseAdminApp();
    const db = app.firestore();
    await db.collection("users").doc(uid).set(updates, { merge: true });

    if (updates.email) {
      try {
        await app.auth().updateUser(uid, { email: updates.email });
      } catch (authErr: any) {
        console.warn("api/admin/users update auth email failed:", authErr?.message);
      }
    }

    return res.json({ success: true, data: updates });
  } catch (err: any) {
    console.error("api/admin/users update error:", err);
    return res.status(500).json({ success: false, error: "Failed to update user", message: err?.message });
  }
});

apiApp.delete("/admin/users/:uid", async (req: Request, res: Response) => {
  try {
    const decoded = (req as any).user as admin.auth.DecodedIdToken;
    if (!(await requireAdmin(decoded))) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    const uid = String(req.params.uid || "").trim();
    if (!uid) {
      return res.status(400).json({ success: false, error: "uid is required" });
    }

    const app = getFirebaseAdminApp();
    const db = app.firestore();
    await db.collection("users").doc(uid).delete();

    try {
      await app.auth().deleteUser(uid);
    } catch (authErr: any) {
      console.warn("api/admin/users delete auth user failed:", authErr?.message);
    }

    return res.json({ success: true });
  } catch (err: any) {
    console.error("api/admin/users delete error:", err);
    return res.status(500).json({ success: false, error: "Failed to delete user", message: err?.message });
  }
});

apiApp.post("/admin/users/set-password", async (req: Request, res: Response) => {
  try {
    const decoded = (req as any).user as admin.auth.DecodedIdToken;
    if (!(await requireAdmin(decoded))) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    const uid = String(req.body?.uid || "").trim();
    const pw = String(req.body?.newPassword || "").trim();

    if (!uid) {
      return res.status(400).json({ success: false, error: "uid is required" });
    }

    if (!pw || pw.length < 6) {
      return res.status(400).json({ success: false, error: "newPassword must be at least 6 characters" });
    }

    const app = getFirebaseAdminApp();
    await app.auth().updateUser(uid, { password: pw });

    return res.json({ success: true });
  } catch (err: any) {
    console.error("api/admin/users/set-password error:", err);
    return res.status(500).json({ success: false, error: "Failed to set password", message: err?.message });
  }
});

// =====================================================
// SCHOOLS MANAGEMENT
// =====================================================

// GET /admin/schools - list all schools
apiApp.get("/admin/schools", async (req: Request, res: Response) => {
  try {
    const decoded = (req as any).user as admin.auth.DecodedIdToken;
    if (!(await requireAdmin(decoded))) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    const app = getFirebaseAdminApp();
    const db = app.firestore();
    const schoolsSnap = await db.collection("schools").orderBy("createdAt", "desc").get();

    const schools = schoolsSnap.docs.map((doc) => {
      const data = doc.data() || {};
      return {
        id: doc.id,
        name: String((data as any).name || ""),
        teacherCount: Number((data as any).teacherCount || 0),
        registeredCount: Number((data as any).registeredCount || 0),
        createdAt: (data as any).createdAt || null
      };
    });

    return res.json({ success: true, data: { schools } });
  } catch (err: any) {
    console.error("api/admin/schools list error:", err);
    return res.status(500).json({ success: false, error: "Failed to list schools", message: err?.message });
  }
});

// POST /admin/schools - create a new school
apiApp.post("/admin/schools", async (req: Request, res: Response) => {
  try {
    const decoded = (req as any).user as admin.auth.DecodedIdToken;
    if (!(await requireAdmin(decoded))) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    const schoolName = String(req.body?.name || "").trim();
    if (!schoolName) {
      return res.status(400).json({ success: false, error: "School name is required" });
    }

    const app = getFirebaseAdminApp();
    const db = app.firestore();
    const id = Date.now().toString();

    await db.collection("schools").doc(id).set({
      id,
      name: schoolName,
      teacherCount: 0,
      registeredCount: 0,
      createdAt: Date.now(),
      createdBy: decoded.uid || "unknown"
    });

    return res.json({
      success: true,
      data: { id, name: schoolName, teacherCount: 0, registeredCount: 0 }
    });
  } catch (err: any) {
    console.error("api/admin/schools create error:", err);
    return res.status(500).json({ success: false, error: "Failed to create school", message: err?.message });
  }
});

// PUT /admin/schools/:schoolId - update school name
apiApp.put("/admin/schools/:schoolId", async (req: Request, res: Response) => {
  try {
    const decoded = (req as any).user as admin.auth.DecodedIdToken;
    if (!(await requireAdmin(decoded))) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    const schoolId = String(req.params.schoolId || "").trim();
    const schoolName = String(req.body?.name || "").trim();

    if (!schoolName) {
      return res.status(400).json({ success: false, error: "School name is required" });
    }

    const app = getFirebaseAdminApp();
    const db = app.firestore();
    await db.collection("schools").doc(schoolId).set({
      name: schoolName,
      updatedAt: Date.now()
    }, { merge: true });

    return res.json({ success: true, data: { id: schoolId, name: schoolName } });
  } catch (err: any) {
    console.error("api/admin/schools update error:", err);
    return res.status(500).json({ success: false, error: "Failed to update school", message: err?.message });
  }
});

// DELETE /admin/schools/:schoolId - delete a school and its roster
apiApp.delete("/admin/schools/:schoolId", async (req: Request, res: Response) => {
  try {
    const decoded = (req as any).user as admin.auth.DecodedIdToken;
    if (!(await requireAdmin(decoded))) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    const schoolId = String(req.params.schoolId || "").trim();
    const app = getFirebaseAdminApp();
    const db = app.firestore();

    // Delete all teachers in the roster subcollection
    const rosterSnap = await db.collection("schools").doc(schoolId).collection("roster").get();
    const batch = db.batch();
    rosterSnap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();

    // Delete the school document
    await db.collection("schools").doc(schoolId).delete();

    return res.json({ success: true });
  } catch (err: any) {
    console.error("api/admin/schools delete error:", err);
    return res.status(500).json({ success: false, error: "Failed to delete school", message: err?.message });
  }
});

// =====================================================
// TEACHER ROSTER MANAGEMENT
// =====================================================

// GET /admin/schools/:schoolId/roster - get teacher roster
apiApp.get("/admin/schools/:schoolId/roster", async (req: Request, res: Response) => {
  try {
    const decoded = (req as any).user as admin.auth.DecodedIdToken;
    if (!(await requireAdmin(decoded))) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    const schoolId = String(req.params.schoolId || "").trim();
    const app = getFirebaseAdminApp();
    const db = app.firestore();

    const rosterSnap = await db
      .collection("schools")
      .doc(schoolId)
      .collection("roster")
      .orderBy("name", "asc")
      .get();

    const teachers = rosterSnap.docs.map((doc) => {
      const data = doc.data() || {};
      return {
        id: doc.id,
        teacherId: String((data as any).teacherId || ""),
        name: String((data as any).name || ""),
        registered: Boolean((data as any).registered),
        registeredAt: (data as any).registeredAt || null,
        uid: (data as any).uid || null,
        email: (data as any).email || null
      };
    });

    return res.json({ success: true, data: { teachers } });
  } catch (err: any) {
    console.error("api/admin/roster get error:", err);
    return res.status(500).json({ success: false, error: "Failed to get roster", message: err?.message });
  }
});

// POST /admin/schools/:schoolId/roster/import - import teachers
apiApp.post("/admin/schools/:schoolId/roster/import", async (req: Request, res: Response) => {
  try {
    const decoded = (req as any).user as admin.auth.DecodedIdToken;
    if (!(await requireAdmin(decoded))) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    const schoolId = String(req.params.schoolId || "").trim();
    const teachers = req.body?.teachers;

    if (!Array.isArray(teachers) || teachers.length === 0) {
      return res.status(400).json({ success: false, error: "Teachers array is required" });
    }

    const app = getFirebaseAdminApp();
    const db = app.firestore();
    const batch = db.batch();
    let imported = 0;
    let skipped = 0;
    const errors: { teacherId: string; reason: string }[] = [];

    for (const teacher of teachers) {
      const teacherId = String(teacher.teacherId || teacher.teacher_id || "").trim();
      const name = String(teacher.name || teacher.teacherName || teacher.teacher_name || "").trim();

      if (!teacherId || !name) {
        skipped++;
        continue;
      }

      // Enforce global uniqueness using a dedicated index document
      const idxRef = db.collection("teacherIdIndex").doc(teacherId);
      const idxSnap = await idxRef.get();
      if (idxSnap.exists) {
        const idxData: any = idxSnap.data() || {};
        const existingSchoolId = String(idxData.schoolId || "").trim();
        if (existingSchoolId && existingSchoolId !== String(schoolId)) {
          skipped++;
          errors.push({ teacherId, reason: "Teacher ID already exists in another school" });
          continue;
        }
      }

      const docRef = db.collection("schools").doc(schoolId).collection("roster").doc(teacherId);
      batch.set(docRef, {
        teacherId,
        name,
        registered: false,
        registeredAt: null,
        uid: null,
        email: null,
        importedAt: Date.now()
      });

      batch.set(
        idxRef,
        {
          teacherId,
          schoolId: String(schoolId),
          name,
          updatedAt: Date.now(),
          createdAt: idxSnap.exists ? (idxSnap.data() as any)?.createdAt || Date.now() : Date.now()
        },
        { merge: true }
      );
      imported++;
    }

    await batch.commit();

    // Update school teacher count
    const rosterSnap = await db.collection("schools").doc(schoolId).collection("roster").get();
    await db.collection("schools").doc(schoolId).set({
      teacherCount: rosterSnap.size
    }, { merge: true });

    return res.json({
      success: true,
      data: { imported, skipped, errors: errors.slice(0, 10) }
    });
  } catch (err: any) {
    console.error("api/admin/roster import error:", err);
    return res.status(500).json({ success: false, error: "Failed to import roster", message: err?.message });
  }
});

// DELETE /admin/schools/:schoolId/roster/:teacherId - remove teacher from roster
apiApp.delete("/admin/schools/:schoolId/roster/:teacherId", async (req: Request, res: Response) => {
  try {
    const decoded = (req as any).user as admin.auth.DecodedIdToken;
    if (!(await requireAdmin(decoded))) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    const schoolId = String(req.params.schoolId || "").trim();
    const teacherId = String(req.params.teacherId || "").trim();
    const app = getFirebaseAdminApp();
    const db = app.firestore();

    await db.collection("schools").doc(schoolId).collection("roster").doc(teacherId).delete();

    // Keep global index in sync
    try {
      await db.collection("teacherIdIndex").doc(teacherId).delete();
    } catch (e) {
      console.error("api/admin/roster delete: failed to delete teacherIdIndex doc", e);
    }

    // Update counts
    const rosterSnap = await db.collection("schools").doc(schoolId).collection("roster").get();
    const registeredSnap = await db
      .collection("schools")
      .doc(schoolId)
      .collection("roster")
      .where("registered", "==", true)
      .get();

    await db.collection("schools").doc(schoolId).set({
      teacherCount: rosterSnap.size,
      registeredCount: registeredSnap.size
    }, { merge: true });

    return res.json({ success: true });
  } catch (err: any) {
    console.error("api/admin/roster delete error:", err);
    return res.status(500).json({ success: false, error: "Failed to delete teacher from roster", message: err?.message });
  }
});

// GET /admin/roster/check-teacher-id - check if teacher ID is valid for registration
apiApp.get("/admin/roster/check-teacher-id", async (req: Request, res: Response) => {
  try {
    const tid = String(req.query.teacherId || "").trim();
    if (!tid) {
      return res.status(400).json({ success: false, error: "teacherId is required" });
    }

    const app = getFirebaseAdminApp();
    const db = app.firestore();

    const idxSnap = await db.collection("teacherIdIndex").doc(tid).get();
    if (!idxSnap.exists) {
      return res.json({
        success: true,
        data: { exists: false, valid: false, reason: "Teacher ID not found in any school roster" }
      });
    }

    const idxData: any = idxSnap.data() || {};
    const schoolId = String(idxData.schoolId || "").trim() || null;
    if (!schoolId) {
      return res.json({
        success: true,
        data: { exists: false, valid: false, reason: "Teacher ID index is missing school information" }
      });
    }

    const teacherDoc = await db.collection("schools").doc(schoolId).collection("roster").doc(tid).get();
    if (!teacherDoc.exists) {
      return res.json({
        success: true,
        data: { exists: false, valid: false, reason: "Teacher ID not found in school roster" }
      });
    }

    const teacherData: any = teacherDoc.data() || {};

    let schoolName = "";
    if (schoolId) {
      const schoolDoc = await db.collection("schools").doc(schoolId).get();
      if (schoolDoc.exists) {
        schoolName = String((schoolDoc.data() as any)?.name || "");
      }
    }

    if (teacherData.registered) {
      return res.json({
        success: true,
        data: {
          exists: true,
          valid: false,
          reason: "Teacher ID is already registered",
          name: teacherData.name,
          schoolId,
          schoolName,
          registeredAt: teacherData.registeredAt
        }
      });
    }

    return res.json({
      success: true,
      data: {
        exists: true,
        valid: true,
        reason: "Teacher ID is valid for registration",
        name: teacherData.name,
        schoolId,
        schoolName
      }
    });
  } catch (err: any) {
    console.error("api/admin/roster/check-teacher-id error:", err);
    return res.status(500).json({ success: false, error: "Failed to check teacher ID", message: err?.message });
  }
});

// POST /admin/roster/mark-registered - mark teacher as registered
apiApp.post("/admin/roster/mark-registered", async (req: Request, res: Response) => {
  try {
    const tid = String(req.body?.teacherId || "").trim();
    const uid = String(req.body?.uid || "").trim();
    const email = String(req.body?.email || "").trim();

    if (!tid) {
      return res.status(400).json({ success: false, error: "teacherId is required" });
    }

    const app = getFirebaseAdminApp();
    const db = app.firestore();

    const idxSnap = await db.collection("teacherIdIndex").doc(tid).get();
    if (!idxSnap.exists) {
      return res.status(404).json({ success: false, error: "Teacher not found in roster" });
    }

    const idxData: any = idxSnap.data() || {};
    const schoolId = String(idxData.schoolId || "").trim();
    if (!schoolId) {
      return res.status(404).json({ success: false, error: "Teacher not found in roster" });
    }

    const teacherRef = db.collection("schools").doc(schoolId).collection("roster").doc(tid);
    await teacherRef.set({
      registered: true,
      registeredAt: Date.now(),
      uid: uid || null,
      email: email || null
    }, { merge: true });

    if (schoolId) {
      const registeredSnap = await db
        .collection("schools")
        .doc(schoolId)
        .collection("roster")
        .where("registered", "==", true)
        .get();

      await db.collection("schools").doc(schoolId).set({
        registeredCount: registeredSnap.size
      }, { merge: true });
    }

    return res.json({ success: true });
  } catch (err: any) {
    console.error("api/admin/roster/mark-registered error:", err);
    return res.status(500).json({ success: false, error: "Failed to mark teacher as registered", message: err?.message });
  }
});

// GET /admin/schools/:schoolId/export - export roster
apiApp.get("/admin/schools/:schoolId/export", async (req: Request, res: Response) => {
  try {
    const decoded = (req as any).user as admin.auth.DecodedIdToken;
    if (!(await requireAdmin(decoded))) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    const schoolId = String(req.params.schoolId || "").trim();
    const app = getFirebaseAdminApp();
    const db = app.firestore();

    const schoolDoc = await db.collection("schools").doc(schoolId).get();
    if (!schoolDoc.exists) {
      return res.status(404).json({ success: false, error: "School not found" });
    }

    const schoolData = schoolDoc.data();
    const rosterSnap = await db
      .collection("schools")
      .doc(schoolId)
      .collection("roster")
      .orderBy("name", "asc")
      .get();

    const teachers = rosterSnap.docs.map((doc) => {
      const data = doc.data() || {};
      return {
        teacherId: String((data as any).teacherId || ""),
        name: String((data as any).name || ""),
        registered: Boolean((data as any).registered) ? "Yes" : "No",
        registeredAt: (data as any).registeredAt ? new Date((data as any).registeredAt).toISOString() : "",
        email: (data as any).email || ""
      };
    });

    return res.json({
      success: true,
      data: {
        schoolName: (schoolData as any)?.name || "",
        exportedAt: new Date().toISOString(),
        teachers
      }
    });
  } catch (err: any) {
    console.error("api/admin/roster export error:", err);
    return res.status(500).json({ success: false, error: "Failed to export roster", message: err?.message });
  }
});

export const api = functions.https.onRequest(apiApp);
//   response.send("Hello from Firebase!");
// });



export const generateQuestionsWithAI = functions
  .https
  .onCall(async (data) => {

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new HttpsError(
      "failed-precondition",
      "Missing Gemini API key. Set it with: firebase functions:config:set gemini.key=\"YOUR_KEY\""
    );
  }

  const topic = String(data?.topic || "").trim();
  const competency = String(data?.competency || "").trim();
  const cognitiveLevel = String(data?.cognitiveLevel || "").trim();
  const count = Number(data?.count ?? 5);
  const mode = String(data?.mode || "mcq").trim();
  const customPrompt = String(data?.prompt || "").trim();

  if (!customPrompt && (!topic || !competency || !cognitiveLevel)) {
    throw new HttpsError("invalid-argument", "topic, competency, and cognitiveLevel are required");
  }

  const n = Number.isFinite(count) && count > 0 ? Math.min(Math.floor(count), 20) : 5;

  const prompt = customPrompt
    ? (
        `You are an exam question generator.\n` +
        `User request: ${customPrompt}\n\n` +
        `Return ONLY valid JSON.\n` +
        (mode === "mcq"
          ? `{"questions":[{"question":"...","choices":{"A":"...","B":"...","C":"...","D":"..."},"answer":"A"}]}`
          : `{"questions":["...","..."]}`)
      )
    : (
        `Generate ${n} exam questions.\n` +
        `Topic: ${topic}\n` +
        `Learning competency: ${competency}\n` +
        `Bloom level: ${cognitiveLevel}\n\n` +
        (mode === "mcq"
          ? (
              `Generate multiple-choice questions. Each item MUST include:\n` +
              `- question (string)\n` +
              `- choices (object with keys A,B,C,D and string values)\n` +
              `- answer (one of: \"A\",\"B\",\"C\",\"D\")\n\n` +
              `Return ONLY valid JSON in this exact format:\n` +
              `{"questions":[{"question":"...","choices":{"A":"...","B":"...","C":"...","D":"..."},"answer":"A"}]}`
            )
          : (
              `Return ONLY valid JSON in this exact format:\n` +
              `{"questions":["...","..."]}`
            ))
      );

  const listUrl =
    "https://generativelanguage.googleapis.com/v1beta/models?key=" +
    encodeURIComponent(String(apiKey));

  const modelPreference = [
    "models/gemini-1.5-flash",
    "models/gemini-1.5-pro",
    "models/gemini-1.0-pro",
  ];

  let models: any[] = [];
  let listModelsErrorText = "";
  try {
    const listResp = await fetch(listUrl);
    if (!listResp.ok) {
      listModelsErrorText = await listResp.text();
    } else {
      const listJson: any = await listResp.json();
      models = Array.isArray(listJson?.models) ? listJson.models : [];
    }
  } catch (e: any) {
    listModelsErrorText = e?.message ? String(e.message) : String(e);
  }

  const supported = models.filter((m) =>
    m &&
    typeof m === "object" &&
    typeof m.name === "string" &&
    Array.isArray(m.supportedGenerationMethods) &&
    m.supportedGenerationMethods.includes("generateContent")
  );

  const supportedNames = supported.map((m) => String(m.name));
  const preferredSupported = modelPreference.filter((pref) => supportedNames.includes(pref));
  const otherSupported = supportedNames.filter((name) => !preferredSupported.includes(name));
  const modelCandidates = [...preferredSupported, ...otherSupported];

  if (modelCandidates.length === 0) {
    throw new HttpsError(
      "failed-precondition",
      `No Gemini model with generateContent is available for this API key. ListModels error: ${listModelsErrorText || "(none)"}`
    );
  }

  const callGemini = async (modelName: string) => {
    const genUrl =
      `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=` +
      encodeURIComponent(String(apiKey));

    return fetch(genUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7 },
      }),
    });
  };

  let lastErrText = "";
  let lastStatus: number | undefined;
  let json: any = null;

  for (const modelName of modelCandidates) {
    const resp = await callGemini(modelName);

    if (resp.ok) {
      json = await resp.json();
      break;
    }

    lastStatus = resp.status;
    lastErrText = await resp.text();

    if (resp.status === 429) {
      throw new HttpsError(
        "resource-exhausted",
        `Gemini quota/rate limit exceeded. Please wait and try again, or check your Gemini API quota/billing. Details: ${lastErrText}`
      );
    }

    const errLower = String(lastErrText || "").toLowerCase();
    const isModelNotFound =
      resp.status === 404 ||
      errLower.includes("model not found") ||
      errLower.includes("is no longer available") ||
      errLower.includes("not_found");

    if (isModelNotFound) {
      continue;
    }

    throw new HttpsError("internal", `Gemini API error: ${lastErrText}`);
  }

  if (!json) {
    throw new HttpsError(
      "failed-precondition",
      `No supported Gemini model succeeded. Last status: ${String(lastStatus ?? "(unknown)")}. Details: ${lastErrText}`
    );
  }

  const textOut = String(json?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
  if (!textOut) {
    return { questions: [] };
  }

  try {
    const extractJsonCandidate = (s: string): string => {
      const trimmed = String(s || "").trim();

      const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (fenceMatch && fenceMatch[1]) return String(fenceMatch[1]).trim();

      const firstBrace = trimmed.indexOf("{");
      const lastBrace = trimmed.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        return trimmed.slice(firstBrace, lastBrace + 1).trim();
      }

      return trimmed;
    };

    const parsed = JSON.parse(extractJsonCandidate(textOut));
    if (mode === "mcq") {
      const items = Array.isArray(parsed?.questions) ? parsed.questions : [];
      const questions = items
        .map((it: any) => {
          const question = String(it?.question || "").trim();
          const choices = it?.choices && typeof it.choices === "object" ? it.choices : {};
          const A = String(choices?.A || "").trim();
          const B = String(choices?.B || "").trim();
          const C = String(choices?.C || "").trim();
          const D = String(choices?.D || "").trim();
          const answer = String(it?.answer || "").trim().toUpperCase();

          if (!question || !A || !B || !C || !D) return null;
          if (!["A", "B", "C", "D"].includes(answer)) return null;
          return { question, choices: { A, B, C, D }, answer };
        })
        .filter(Boolean);

      return { questions };
    }

    const questions = Array.isArray(parsed?.questions) ? parsed.questions.map((q: any) => String(q)) : [];
    return { questions };
  } catch {
    // If Gemini didn't return valid JSON, return the raw text so the client can display it.
    return { questions: [textOut] };
  }

});


export const gradeOmrWithAI = functions
  .https
  .onCall(async (data) => {

  const gradingResults = Array.isArray(data?.gradingResults) ? data.gradingResults : null;
  if (!gradingResults) {
    throw new HttpsError("invalid-argument", "gradingResults must be an array");
  }

  // The client may optionally send these, but we don't require them yet.
  const answerKey = data?.answerKey ?? null;
  const imageBase64 = data?.imageBase64 ?? null;

  const apiKey = getGeminiApiKey();
  const imgStr = typeof imageBase64 === "string" ? imageBase64 : "";
  const hasImage = imgStr.startsWith("data:image/") || /^[A-Za-z0-9+/=]+$/.test(imgStr);
  if (!apiKey || !hasImage) {
    console.log(
      "[gradeOmrWithAI] Skipping Gemini Vision. hasKey:",
      Boolean(apiKey),
      "hasImage:",
      hasImage,
      "gradingResults:",
      Array.isArray(gradingResults) ? gradingResults.length : 0
    );
    return {
      gradingResults,
      answerKey,
      imageBase64: null,
    };
  }

  const stripDataUrl = (s: string): { mime: string; b64: string } => {
    const m = s.match(/^data:(image\/[^;]+);base64,(.*)$/i);
    if (m && m[1] && m[2]) return { mime: String(m[1]), b64: String(m[2]) };
    return { mime: "image/jpeg", b64: s };
  };

  const { mime, b64 } = stripDataUrl(imgStr);

  const prompt =
    `You are grading an OMR answer sheet photo.\n` +
    `Return ONLY valid JSON.\n` +
    `Output format: {"gradingResults":[{"questionNumber":1,"detectedAnswer":"A"|"B"|"C"|"D"|null,"status":"Blank"|"Invalid"|"Correct"|"Incorrect","confidence":0.0}]}\n` +
    `Rules:\n` +
    `- questionNumber must be 1..N\n` +
    `- detectedAnswer must be A/B/C/D or null if blank\n` +
    `- If multiple marks or unclear, set status Invalid and detectedAnswer null\n` +
    `- If no mark, status Blank and detectedAnswer null\n` +
    `- confidence is 0..1\n\n` +
    `Here are the current on-device results (may contain errors):\n` +
    `${JSON.stringify({ gradingResults }, null, 0)}\n\n` +
    `Answer key (may be null):\n` +
    `${JSON.stringify({ answerKey }, null, 0)}\n`;

  const extractJsonCandidate = (s: string): string => {
    const trimmed = String(s || "").trim();
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch && fenceMatch[1]) return String(fenceMatch[1]).trim();
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      return trimmed.slice(firstBrace, lastBrace + 1).trim();
    }
    return trimmed;
  };

  const callGeminiVision = async (modelName: string) => {
    const resource = String(modelName || "").startsWith("models/")
      ? String(modelName)
      : `models/${String(modelName)}`;

    const url =
      `https://generativelanguage.googleapis.com/v1beta/${resource}:generateContent?key=` +
      encodeURIComponent(String(apiKey));

    const body = {
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mime, data: b64 } },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
      },
    };

    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  };

  const listUrl =
    "https://generativelanguage.googleapis.com/v1beta/models?key=" +
    encodeURIComponent(String(apiKey));

  let models: any[] = [];
  let listModelsErrorText = "";
  try {
    const listResp = await fetch(listUrl);
    if (!listResp.ok) {
      listModelsErrorText = await listResp.text();
    } else {
      const listJson: any = await listResp.json();
      models = Array.isArray(listJson?.models) ? listJson.models : [];
    }
  } catch (e: any) {
    listModelsErrorText = e?.message ? String(e.message) : String(e);
  }

  const supported = models.filter((m) =>
    m &&
    typeof m === "object" &&
    typeof m.name === "string" &&
    Array.isArray(m.supportedGenerationMethods) &&
    m.supportedGenerationMethods.includes("generateContent")
  );

  const supportedNames = supported.map((m) => String(m.name));

  const modelPreference = [
    "models/gemini-2.0-flash",
    "models/gemini-2.0-flash-lite",
    "models/gemini-1.5-flash",
    "models/gemini-1.5-pro",
    "models/gemini-pro-vision",
    "models/gemini-1.0-pro-vision",
    "models/gemini-pro",
    "models/gemini-1.0-pro",
  ];

  const preferredSupported = modelPreference.filter((pref) => supportedNames.includes(pref));
  const otherSupported = supportedNames.filter((name) => !preferredSupported.includes(name));
  const modelCandidates = [...preferredSupported, ...otherSupported];

  if (modelCandidates.length === 0) {
    throw new HttpsError(
      "failed-precondition",
      `No Gemini model with generateContent is available for this API key. ListModels error: ${listModelsErrorText || "(none)"}`
    );
  }

  let textOut = "";
  let lastErrText = "";
  let lastStatus: number | undefined;
  for (const model of modelCandidates) {
    console.log("[gradeOmrWithAI] Calling Gemini model:", model);
    const resp = await callGeminiVision(model);
    if (resp.ok) {
      const json: any = await resp.json();
      textOut = String(json?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
      console.log(
        "[gradeOmrWithAI] Gemini ok:",
        resp.status,
        "textLen:",
        textOut.length
      );
      if (textOut) break;
      lastErrText = JSON.stringify(json);
      break;
    }
    lastStatus = resp.status;
    lastErrText = await resp.text();
    console.log("[gradeOmrWithAI] Gemini error:", resp.status, lastErrText);
    if (resp.status === 429) {
      throw new HttpsError(
        "resource-exhausted",
        `Gemini quota/rate limit exceeded. Details: ${lastErrText}`
      );
    }
  }

  if (!textOut) {
    throw new HttpsError(
      "internal",
      `Gemini Vision returned no text. Last status: ${String(lastStatus ?? "(unknown)")}. Details: ${lastErrText}`
    );
  }

  try {
    const parsed = JSON.parse(extractJsonCandidate(textOut));
    const aiResults = Array.isArray(parsed?.gradingResults) ? parsed.gradingResults : [];
    console.log("[gradeOmrWithAI] Parsed AI gradingResults:", aiResults.length);
    if (!aiResults.length) {
      return {
        gradingResults,
        answerKey,
        imageBase64: null,
      };
    }
    return {
      gradingResults: aiResults,
    };
  } catch {
    console.log("[gradeOmrWithAI] Failed to parse AI JSON.");
    return {
      gradingResults,
      answerKey,
      imageBase64: null,
    };
  }

});
