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

// =====================================================
// SCHOOLS MANAGEMENT
// =====================================================

// GET /schools - list all schools
router.get('/schools', verifyToken, async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;

    const db = firebaseDbAdmin();
    const schoolsSnap = await db.collection('schools').orderBy('createdAt', 'desc').get();

    const schools = schoolsSnap.docs.map((doc) => {
      const data = doc.data() || {};
      return {
        id: doc.id,
        name: String(data.name || ''),
        teacherCount: Number(data.teacherCount || 0),
        registeredCount: Number(data.registeredCount || 0),
        createdAt: data.createdAt || null
      };
    });

    return res.json({ success: true, data: { schools } });
  } catch (err) {
    console.error('admin/schools list error:', err);
    return res.status(500).json({ success: false, error: 'Failed to list schools', message: err.message });
  }
});

// POST /schools - create a new school
router.post('/schools', verifyToken, async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;

    const { name } = req.body;
    const schoolName = String(name || '').trim();

    if (!schoolName) {
      return res.status(400).json({ success: false, error: 'School name is required' });
    }

    const db = firebaseDbAdmin();
    const id = Date.now().toString();

    await db.collection('schools').doc(id).set({
      id,
      name: schoolName,
      teacherCount: 0,
      registeredCount: 0,
      createdAt: Date.now(),
      createdBy: req.user?.id || 'unknown'
    });

    return res.json({
      success: true,
      data: {
        id,
        name: schoolName,
        teacherCount: 0,
        registeredCount: 0
      }
    });
  } catch (err) {
    console.error('admin/schools create error:', err);
    return res.status(500).json({ success: false, error: 'Failed to create school', message: err.message });
  }
});

// PUT /schools/:schoolId - update school name
router.put('/schools/:schoolId', verifyToken, async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;

    const { schoolId } = req.params;
    const { name } = req.body;
    const schoolName = String(name || '').trim();

    if (!schoolName) {
      return res.status(400).json({ success: false, error: 'School name is required' });
    }

    const db = firebaseDbAdmin();
    await db.collection('schools').doc(schoolId).set({
      name: schoolName,
      updatedAt: Date.now()
    }, { merge: true });

    return res.json({ success: true, data: { id: schoolId, name: schoolName } });
  } catch (err) {
    console.error('admin/schools update error:', err);
    return res.status(500).json({ success: false, error: 'Failed to update school', message: err.message });
  }
});

// DELETE /schools/:schoolId - delete a school and its roster
router.delete('/schools/:schoolId', verifyToken, async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;

    const { schoolId } = req.params;
    const db = firebaseDbAdmin();

    // Delete all teachers in the roster subcollection
    const rosterSnap = await db.collection('schools').doc(schoolId).collection('roster').get();
    const batch = db.batch();
    rosterSnap.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });
    await batch.commit();

    // Delete the school document
    await db.collection('schools').doc(schoolId).delete();

    return res.json({ success: true });
  } catch (err) {
    console.error('admin/schools delete error:', err);
    return res.status(500).json({ success: false, error: 'Failed to delete school', message: err.message });
  }
});

// =====================================================
// TEACHER ROSTER MANAGEMENT
// =====================================================

// GET /schools/:schoolId/roster - get teacher roster with registration status
router.get('/schools/:schoolId/roster', verifyToken, async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;

    const { schoolId } = req.params;
    const db = firebaseDbAdmin();

    const rosterSnap = await db
      .collection('schools')
      .doc(schoolId)
      .collection('roster')
      .orderBy('name', 'asc')
      .get();

    const teachers = rosterSnap.docs.map((doc) => {
      const data = doc.data() || {};
      return {
        id: doc.id,
        teacherId: String(data.teacherId || ''),
        name: String(data.name || ''),
        registered: Boolean(data.registered),
        registeredAt: data.registeredAt || null,
        uid: data.uid || null,
        email: data.email || null
      };
    });

    return res.json({ success: true, data: { teachers } });
  } catch (err) {
    console.error('admin/roster get error:', err);
    return res.status(500).json({ success: false, error: 'Failed to get roster', message: err.message });
  }
});

router.post('/schools/:schoolId/roster/import', verifyToken, async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;

    const { schoolId } = req.params;
    const { teachers } = req.body;

    if (!Array.isArray(teachers) || teachers.length === 0) {
      return res.status(400).json({ success: false, error: 'Teachers array is required' });
    }

    const db = firebaseDbAdmin();
    const batch = db.batch();
    let imported = 0;
    let skipped = 0;
    const errors = [];

    for (const teacher of teachers) {
      const teacherId = String(teacher.teacherId || teacher.teacher_id || '').trim();
      const name = String(teacher.name || teacher.teacherName || teacher.teacher_name || '').trim();

      if (!teacherId || !name) {
        skipped++;
        continue;
      }

      // Enforce global uniqueness using a dedicated index document
      // This avoids collectionGroup queries that can require manual index setup.
      const idxRef = db.collection('teacherIdIndex').doc(teacherId);
      const idxSnap = await idxRef.get();
      if (idxSnap.exists) {
        const idxData = idxSnap.data() || {};
        const existingSchoolId = String(idxData.schoolId || '').trim();
        if (existingSchoolId && existingSchoolId !== String(schoolId)) {
          skipped++;
          errors.push({ teacherId, reason: 'Teacher ID already exists in another school' });
          continue;
        }
      }

      const docRef = db.collection('schools').doc(schoolId).collection('roster').doc(teacherId);
      batch.set(docRef, {
        teacherId,
        name,
        registered: false,
        registeredAt: null,
        uid: null,
        email: null,
        importedAt: Date.now()
      });

      batch.set(idxRef, {
        teacherId,
        schoolId: String(schoolId),
        name,
        updatedAt: Date.now(),
        createdAt: idxSnap.exists ? (idxSnap.data() || {}).createdAt || Date.now() : Date.now()
      }, { merge: true });
      imported++;
    }

    await batch.commit();

    // Update school teacher count
    const rosterSnap = await db.collection('schools').doc(schoolId).collection('roster').get();
    await db.collection('schools').doc(schoolId).set({
      teacherCount: rosterSnap.size
    }, { merge: true });

    return res.json({
      success: true,
      data: {
        imported,
        skipped,
        errors: errors.slice(0, 10) // Return first 10 errors
      }
    });
  } catch (err) {
    console.error('admin/roster import error:', err);
    return res.status(500).json({ success: false, error: 'Failed to import roster', message: err.message });
  }
});

// POST /schools/:schoolId/roster - manually add a single teacher
router.post('/schools/:schoolId/roster', verifyToken, async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;

    const { schoolId } = req.params;
    const teacherId = String(req.body?.teacherId || '').trim();
    const name = String(req.body?.name || '').trim();

    if (!teacherId || !name) {
      return res.status(400).json({ success: false, error: 'teacherId and name are required' });
    }

    const db = firebaseDbAdmin();

    // Check if teacherId already exists globally
    const idxRef = db.collection('teacherIdIndex').doc(teacherId);
    const idxSnap = await idxRef.get();
    if (idxSnap.exists) {
      const idxData = idxSnap.data() || {};
      const existingSchoolId = String(idxData.schoolId || '').trim();
      if (existingSchoolId && existingSchoolId !== String(schoolId)) {
        return res.status(400).json({ success: false, error: 'Teacher ID already exists in another school' });
      }
    }

    // Add to roster
    await db.collection('schools').doc(schoolId).collection('roster').doc(teacherId).set({
      teacherId,
      name,
      registered: false,
      registeredAt: null,
      uid: null,
      email: null,
      importedAt: Date.now()
    });

    // Update index
    await idxRef.set({
      teacherId,
      schoolId: String(schoolId),
      name,
      updatedAt: Date.now(),
      createdAt: Date.now()
    }, { merge: true });

    // Update school teacher count
    const rosterSnap = await db.collection('schools').doc(schoolId).collection('roster').get();
    await db.collection('schools').doc(schoolId).set({
      teacherCount: rosterSnap.size
    }, { merge: true });

    return res.json({ success: true, data: { teacherId, name } });
  } catch (err) {
    console.error('admin/roster add error:', err);
    return res.status(500).json({ success: false, error: 'Failed to add teacher', message: err.message });
  }
});

// PUT /schools/:schoolId/roster/:teacherId - update teacher (supports changing teacherId and name)
router.put('/schools/:schoolId/roster/:teacherId', verifyToken, async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;

    const { schoolId, teacherId } = req.params;
    const newTeacherId = String(req.body?.teacherId || req.body?.newTeacherId || teacherId).trim();
    const name = String(req.body?.name || '').trim();
    const newSchoolId = String(req.body?.schoolId || schoolId).trim();

    if (!newTeacherId || !name) {
      return res.status(400).json({ success: false, error: 'teacherId and name are required' });
    }

    const db = firebaseDbAdmin();

    // If teacherId or schoolId is changing, we need to handle the move
    if (newTeacherId !== String(teacherId) || newSchoolId !== String(schoolId)) {
      // Check if new teacherId already exists
      const newIdxRef = db.collection('teacherIdIndex').doc(newTeacherId);
      const newIdxSnap = await newIdxRef.get();
      if (newIdxSnap.exists) {
        const idxData = newIdxSnap.data() || {};
        const existingSchoolId = String(idxData.schoolId || '').trim();
        if (existingSchoolId && existingSchoolId !== newSchoolId) {
          return res.status(400).json({ success: false, error: 'Teacher ID already exists in another school' });
        }
      }

      // Get existing teacher data
      const oldDoc = await db.collection('schools').doc(schoolId).collection('roster').doc(String(teacherId)).get();
      if (!oldDoc.exists) {
        return res.status(404).json({ success: false, error: 'Teacher not found' });
      }
      const oldData = oldDoc.data() || {};

      // Delete old index
      await db.collection('teacherIdIndex').doc(String(teacherId)).delete();

      // Delete old roster entry
      await db.collection('schools').doc(schoolId).collection('roster').doc(String(teacherId)).delete();

      // Create new roster entry
      await db.collection('schools').doc(newSchoolId).collection('roster').doc(newTeacherId).set({
        teacherId: newTeacherId,
        name,
        registered: oldData.registered || false,
        registeredAt: oldData.registeredAt || null,
        uid: oldData.uid || null,
        email: oldData.email || null,
        importedAt: oldData.importedAt || Date.now(),
        updatedAt: Date.now()
      });

      // Create new index
      await newIdxRef.set({
        teacherId: newTeacherId,
        schoolId: newSchoolId,
        name,
        updatedAt: Date.now(),
        createdAt: oldData.importedAt || Date.now()
      });

      // Update teacher counts for both schools if different
      if (newSchoolId !== String(schoolId)) {
        const oldRosterSnap = await db.collection('schools').doc(schoolId).collection('roster').get();
        await db.collection('schools').doc(schoolId).set({ teacherCount: oldRosterSnap.size }, { merge: true });

        const newRosterSnap = await db.collection('schools').doc(newSchoolId).collection('roster').get();
        await db.collection('schools').doc(newSchoolId).set({ teacherCount: newRosterSnap.size }, { merge: true });
      }

      return res.json({ success: true, data: { teacherId: newTeacherId, schoolId: newSchoolId, name } });
    }

    // Just updating name
    await db.collection('schools').doc(schoolId).collection('roster').doc(String(teacherId)).set({
      name,
      updatedAt: Date.now()
    }, { merge: true });

    // Keep teacherIdIndex in sync
    await db.collection('teacherIdIndex').doc(String(teacherId)).set({
      name,
      schoolId: String(schoolId),
      updatedAt: Date.now()
    }, { merge: true });

    return res.json({ success: true, data: { teacherId: String(teacherId), name } });
  } catch (err) {
    console.error('admin/roster update error:', err);
    return res.status(500).json({ success: false, error: 'Failed to update teacher', message: err.message });
  }
});

// DELETE /schools/:schoolId/roster/:teacherId - remove a teacher from roster
router.delete('/schools/:schoolId/roster/:teacherId', verifyToken, async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;

    const { schoolId, teacherId } = req.params;
    const db = firebaseDbAdmin();

    await db.collection('schools').doc(schoolId).collection('roster').doc(teacherId).delete();

    // Keep global index in sync
    try {
      await db.collection('teacherIdIndex').doc(String(teacherId)).delete();
    } catch (e) {
      console.error('admin/roster delete: failed to delete teacherIdIndex doc', e);
    }

    // Update school teacher count
    const rosterSnap = await db.collection('schools').doc(schoolId).collection('roster').get();
    const registeredSnap = await db
      .collection('schools')
      .doc(schoolId)
      .collection('roster')
      .where('registered', '==', true)
      .get();

    await db.collection('schools').doc(schoolId).set({
      teacherCount: rosterSnap.size,
      registeredCount: registeredSnap.size
    }, { merge: true });

    return res.json({ success: true });
  } catch (err) {
    console.error('admin/roster delete error:', err);
    return res.status(500).json({ success: false, error: 'Failed to delete teacher from roster', message: err.message });
  }
});

// GET /roster/check-teacher-id - check if teacher ID exists and is valid for registration
router.get('/roster/check-teacher-id', async (req, res) => {
  try {
    const { teacherId } = req.query;
    const tid = String(teacherId || '').trim();

    if (!tid) {
      return res.status(400).json({ success: false, error: 'teacherId is required' });
    }

    const db = firebaseDbAdmin();

    // Use teacherIdIndex to locate the school quickly (avoids collectionGroup indexes)
    const idxSnap = await db.collection('teacherIdIndex').doc(tid).get();
    if (!idxSnap.exists) {
      return res.json({
        success: true,
        data: {
          exists: false,
          valid: false,
          reason: 'Teacher ID not found in any school roster'
        }
      });
    }

    const idxData = idxSnap.data() || {};
    const schoolId = String(idxData.schoolId || '').trim() || null;
    if (!schoolId) {
      return res.json({
        success: true,
        data: {
          exists: false,
          valid: false,
          reason: 'Teacher ID index is missing school information'
        }
      });
    }

    const teacherDoc = await db.collection('schools').doc(schoolId).collection('roster').doc(tid).get();
    if (!teacherDoc.exists) {
      return res.json({
        success: true,
        data: {
          exists: false,
          valid: false,
          reason: 'Teacher ID not found in school roster'
        }
      });
    }

    const teacherData = teacherDoc.data() || {};

    // Get school name
    let schoolName = '';
    if (schoolId) {
      const schoolDoc = await db.collection('schools').doc(schoolId).get();
      if (schoolDoc.exists) {
        schoolName = schoolDoc.data()?.name || '';
      }
    }

    if (teacherData.registered) {
      return res.json({
        success: true,
        data: {
          exists: true,
          valid: false,
          reason: 'Teacher ID is already registered',
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
        reason: 'Teacher ID is valid for registration',
        name: teacherData.name,
        schoolId,
        schoolName
      }
    });
  } catch (err) {
    console.error('admin/roster/check-teacher-id error:', err);
    return res.status(500).json({ success: false, error: 'Failed to check teacher ID', message: err.message });
  }
});

// POST /roster/mark-registered - mark a teacher as registered (called after successful registration)
router.post('/roster/mark-registered', verifyToken, async (req, res) => {
  try {
    const { teacherId, uid, email } = req.body;
    const tid = String(teacherId || '').trim();

    if (!tid) {
      return res.status(400).json({ success: false, error: 'teacherId is required' });
    }

    const db = firebaseDbAdmin();

    const idxSnap = await db.collection('teacherIdIndex').doc(tid).get();
    if (!idxSnap.exists) {
      return res.status(404).json({ success: false, error: 'Teacher not found in roster' });
    }

    const idxData = idxSnap.data() || {};
    const schoolId = String(idxData.schoolId || '').trim();
    if (!schoolId) {
      return res.status(404).json({ success: false, error: 'Teacher not found in roster' });
    }

    const teacherRef = db.collection('schools').doc(schoolId).collection('roster').doc(tid);

    // Update teacher as registered
    await teacherRef.set({
      registered: true,
      registeredAt: Date.now(),
      uid: uid || null,
      email: email || null
    }, { merge: true });

    // Update school registered count
    if (schoolId) {
      const registeredSnap = await db
        .collection('schools')
        .doc(schoolId)
        .collection('roster')
        .where('registered', '==', true)
        .get();

      await db.collection('schools').doc(schoolId).set({
        registeredCount: registeredSnap.size
      }, { merge: true });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('admin/roster/mark-registered error:', err);
    return res.status(500).json({ success: false, error: 'Failed to mark teacher as registered', message: err.message });
  }
});

// GET /schools/:schoolId/export - export roster as JSON (frontend will convert to Excel)
router.get('/schools/:schoolId/export', verifyToken, async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;

    const { schoolId } = req.params;
    const db = firebaseDbAdmin();

    const schoolDoc = await db.collection('schools').doc(schoolId).get();
    if (!schoolDoc.exists) {
      return res.status(404).json({ success: false, error: 'School not found' });
    }

    const schoolData = schoolDoc.data();

    const rosterSnap = await db
      .collection('schools')
      .doc(schoolId)
      .collection('roster')
      .orderBy('name', 'asc')
      .get();

    const teachers = rosterSnap.docs.map((doc) => {
      const data = doc.data() || {};
      return {
        teacherId: String(data.teacherId || ''),
        name: String(data.name || ''),
        registered: Boolean(data.registered) ? 'Yes' : 'No',
        registeredAt: data.registeredAt ? new Date(data.registeredAt).toISOString() : '',
        email: data.email || ''
      };
    });

    return res.json({
      success: true,
      data: {
        schoolName: schoolData?.name || '',
        exportedAt: new Date().toISOString(),
        teachers
      }
    });
  } catch (err) {
    console.error('admin/roster export error:', err);
    return res.status(500).json({ success: false, error: 'Failed to export roster', message: err.message });
  }
});

module.exports = router;
