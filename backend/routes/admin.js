const express = require('express');
const router = express.Router();

const { verifyToken } = require('../middleware/auth');
const { firebaseAuthAdmin, firebaseDbAdmin } = require('../config/firebaseAdmin');

async function requireAdmin(req, res) {
  try {
    let userType = req.user?.userType;

    if (!userType && req.user?.id) {
      const db = firebaseDbAdmin();
      const doc = await db.collection('users').doc(String(req.user.id)).get();
      const data = doc.exists ? doc.data() : null;
      userType = data ? data.userType : undefined;
      req.user = { ...(req.user || {}), userType };
    }

    if (userType !== 'admin' && userType !== 'school') {
      res.status(403).json({ success: false, error: 'Access denied. Admin only.' });
      return false;
    }

    return true;
  } catch (err) {
    console.error('requireAdmin error:', err);
    res.status(403).json({ success: false, error: 'Access denied. Admin only.' });
    return false;
  }
}

router.get('/metrics/dashboard', verifyToken, async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;

    const startedAt = Date.now();
    const db = firebaseDbAdmin();

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const end = start + 24 * 60 * 60 * 1000;

    const [usersSnap, classesSnap, scansSnap] = await Promise.all([
      db.collection('users').get(),
      db.collectionGroup('classes').get(),
      db.collectionGroup('results').get()
    ]);

    let totalTeachers = 0;
    let totalAdmins = 0;
    usersSnap.forEach((doc) => {
      const data = doc.data() || {};
      const t = String(data.userType || '').trim();
      if (t === 'teacher') totalTeachers++;
      if (t === 'admin' || t === 'school') totalAdmins++;
    });

    let questionsGeneratedToday = 0;
    try {
      const subjectsTodaySnap = await db
        .collectionGroup('subjects')
        .where('questionsUpdatedAt', '>=', start)
        .where('questionsUpdatedAt', '<', end)
        .get();

      subjectsTodaySnap.forEach((doc) => {
        const data = doc.data() || {};
        const list = Array.isArray(data.questions) ? data.questions : [];
        questionsGeneratedToday += list.length;
      });
    } catch (e) {
      const subjectsSnap = await db.collectionGroup('subjects').get();
      subjectsSnap.forEach((doc) => {
        const data = doc.data() || {};
        const updatedAt = Number(data.questionsUpdatedAt);
        if (!Number.isFinite(updatedAt)) return;
        if (updatedAt < start || updatedAt >= end) return;
        const list = Array.isArray(data.questions) ? data.questions : [];
        questionsGeneratedToday += list.length;
      });
    }

    return res.json({
      success: true,
      data: {
        totalUsers: usersSnap.size,
        totalTeachers,
        totalAdmins,
        totalClasses: classesSnap.size,
        totalScannedPapers: scansSnap.size,
        questionsGeneratedToday,
        computedAt: new Date().toISOString(),
        responseTimeMs: Date.now() - startedAt
      }
    });
  } catch (err) {
    console.error('admin/metrics/dashboard error:', err);
    return res.status(500).json({ success: false, error: 'Failed to compute dashboard metrics', message: err.message });
  }
});

router.get('/system/health', verifyToken, async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;

    const startedAt = Date.now();

    return res.json({
      success: true,
      data: {
        status: 'ok',
        timestamp: new Date().toISOString(),
        nodeEnv: process.env.NODE_ENV || 'unknown',
        uptimeSeconds: Math.floor(process.uptime()),
        memory: process.memoryUsage(),
        responseTimeMs: Date.now() - startedAt
      }
    });
  } catch (err) {
    console.error('admin/system/health error:', err);
    return res.status(500).json({ success: false, error: 'Failed to get system health', message: err.message });
  }
});

router.get('/system/db', verifyToken, async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;

    const startedAt = Date.now();
    const db = firebaseDbAdmin();
    // Small, low-cost read to verify Firestore connectivity
    await db.collection('_health').doc('ping').get();

    return res.json({
      success: true,
      data: {
        connected: true,
        result: true,
        responseTimeMs: Date.now() - startedAt
      }
    });
  } catch (err) {
    console.error('admin/system/db error:', err);
    return res.json({
      success: true,
      data: {
        connected: false,
        error: err.message
      }
    });
  }
});

// GET /users - paginated list of users
router.get('/users', verifyToken, async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const search = (req.query.search || '').trim().toLowerCase();

    const db = firebaseDbAdmin();
    const usersSnap = await db.collection('users').get();

    let allUsers = usersSnap.docs.map((doc) => {
      const data = doc.data() || {};
      return {
        id: doc.id,
        email: String(data.email ?? ''),
        name: String(data.name ?? ''),
        userType: data.userType === 'admin' || data.userType === 'school' || data.userType === 'teacher' ? data.userType : 'teacher',
        schoolName: data.schoolName ?? null,
        schoolId: data.schoolId ?? null,
        createdAt: data.createdAt ?? null
      };
    });

    // Filter by search
    if (search) {
      allUsers = allUsers.filter((u) => {
        return (u.name || '').toLowerCase().includes(search) ||
               (u.email || '').toLowerCase().includes(search) ||
               (u.userType || '').toLowerCase().includes(search) ||
               (u.schoolName || '').toLowerCase().includes(search);
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
  } catch (err) {
    console.error('admin/users list error:', err);
    return res.status(500).json({ success: false, error: 'Failed to list users', message: err.message });
  }
});

// PUT /users/:uid - edit user
router.put('/users/:uid', verifyToken, async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;

    const { uid } = req.params;
    const { name, email, userType, schoolName, schoolId } = req.body;

    if (!uid || !`${uid}`.trim()) {
      return res.status(400).json({ success: false, error: 'uid is required' });
    }

    const db = firebaseDbAdmin();
    const updates = {};

    if (typeof name === 'string') updates.name = name.trim();
    if (typeof email === 'string' && email.trim()) updates.email = email.trim();
    if (userType === 'teacher' || userType === 'admin' || userType === 'school') updates.userType = userType;
    if (schoolName !== undefined) updates.schoolName = schoolName || null;
    if (schoolId !== undefined) updates.schoolId = schoolId || null;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, error: 'No valid fields to update' });
    }

    updates.updatedAt = Date.now();

    await db.collection('users').doc(uid).set(updates, { merge: true });

    // Also update Firebase Auth email if changed
    if (updates.email) {
      try {
        const auth = firebaseAuthAdmin();
        await auth.updateUser(uid, { email: updates.email });
      } catch (authErr) {
        console.warn('Failed to update auth email:', authErr.message);
      }
    }

    return res.json({ success: true, data: updates });
  } catch (err) {
    console.error('admin/users update error:', err);
    return res.status(500).json({ success: false, error: 'Failed to update user', message: err.message });
  }
});

// DELETE /users/:uid - delete user
router.delete('/users/:uid', verifyToken, async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;

    const { uid } = req.params;

    if (!uid || !`${uid}`.trim()) {
      return res.status(400).json({ success: false, error: 'uid is required' });
    }

    const db = firebaseDbAdmin();

    // Delete Firestore user doc
    await db.collection('users').doc(uid).delete();

    // Delete Firebase Auth user
    try {
      const auth = firebaseAuthAdmin();
      await auth.deleteUser(uid);
    } catch (authErr) {
      console.warn('Failed to delete auth user:', authErr.message);
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('admin/users delete error:', err);
    return res.status(500).json({ success: false, error: 'Failed to delete user', message: err.message });
  }
});

router.post('/users/set-password', verifyToken, async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;

    const { uid, newPassword } = req.body;

    if (!uid || !`${uid}`.trim()) {
      return res.status(400).json({ success: false, error: 'uid is required' });
    }

    const pw = `${newPassword || ''}`.trim();
    if (!pw || pw.length < 6) {
      return res.status(400).json({ success: false, error: 'newPassword must be at least 6 characters' });
    }

    const auth = firebaseAuthAdmin();
    await auth.updateUser(`${uid}`.trim(), { password: pw });

    return res.json({ success: true });
  } catch (err) {
    console.error('admin/users/set-password error:', err);
    return res.status(500).json({ success: false, error: 'Failed to set password', message: err.message });
  }
});

module.exports = router;
