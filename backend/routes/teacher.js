const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { verifyToken } = require('../middleware/auth');

// Per-teacher cache for dashboard metrics (2 minutes TTL)
const teacherDashboardCache = new Map(); // teacherId -> { data, timestamp }

// Per-teacher cache for classes list (2 minutes TTL)
const teacherClassesCache = new Map(); // teacherId -> { data, timestamp }

// Helper to invalidate teacher cache when data changes
function invalidateTeacherCache(teacherId) {
  teacherDashboardCache.delete(String(teacherId));
  teacherClassesCache.delete(String(teacherId));
}

router.get('/ping', (req, res) => {
  res.json({ success: true, message: 'teacher routes ok' });

});

// CREATE CLASS STUDENT (roster-based)
router.post('/classes/:classId/students', verifyToken, async (req, res) => {
  try {
    const { classId } = req.params;
    const teacherId = req.user.id;
    const { name, email, roll_number } = req.body;

    const connection = await pool.getConnection();

    if (!name || !`${name}`.trim()) {
      connection.release();
      return res.status(400).json({ success: false, error: 'Student name is required' });
    }

    // Verify the class belongs to the teacher
    const [classes] = await connection.query(
      'SELECT id FROM classes WHERE id = ? AND teacher_id = ?',
      [classId, teacherId]
    );

    if (classes.length === 0) {
      connection.release();
      return res.status(403).json({ success: false, error: 'You do not have permission to access this class' });
    }

    const [result] = await connection.query(
      `INSERT INTO students (class_id, user_id, name, email, roll_number)
       VALUES (?, ?, ?, ?, ?)`,
      [
        Number(classId),
        null,
        `${name}`.trim(),
        email && `${email}`.trim() ? `${email}`.trim() : null,
        roll_number && `${roll_number}`.trim() ? `${roll_number}`.trim() : null
      ]
    );

    const newStudent = {
      id: result.insertId,
      name: `${name}`.trim(),
      email: email && `${email}`.trim() ? `${email}`.trim() : null,
      roll_number: roll_number && `${roll_number}`.trim() ? `${roll_number}`.trim() : null,
      class_id: Number(classId)
    };

    connection.release();

    // Invalidate cache since data changed
    invalidateTeacherCache(teacherId);

    res.json({
      success: true,
      student: newStudent,
      message: 'Student added successfully'
    });
  } catch (err) {
    console.error('Error creating student:', err);
    res.status(500).json({ success: false, error: 'Failed to create student', message: err.message });
  }
});

// DELETE CLASS STUDENT (remove from class roster)
router.delete('/classes/:classId/students/:studentId', verifyToken, async (req, res) => {
  try {
    const { classId, studentId } = req.params;
    const teacherId = req.user.id;
    const connection = await pool.getConnection();

    // Verify the class belongs to the teacher
    const [classes] = await connection.query(
      'SELECT id FROM classes WHERE id = ? AND teacher_id = ?',
      [classId, teacherId]
    );

    if (classes.length === 0) {
      connection.release();
      return res.status(403).json({ success: false, error: 'You do not have permission to access this class' });
    }

    // Verify student belongs to this class
    const [students] = await connection.query(
      'SELECT id FROM students WHERE id = ? AND class_id = ?',
      [studentId, classId]
    );

    if (students.length === 0) {
      connection.release();
      return res.status(404).json({ success: false, error: 'Student not found in this class' });
    }

    // Delete from students table; subject enrollments will cascade via FK
    await connection.query('DELETE FROM students WHERE id = ?', [studentId]);

    connection.release();

    // Invalidate cache since data changed
    invalidateTeacherCache(teacherId);

    res.json({ success: true, message: 'Student deleted successfully' });
  } catch (err) {
    console.error('Error deleting student:', err);
    res.status(500).json({ success: false, error: 'Failed to delete student', message: err.message });
  }
});

// UNENROLL STUDENT FROM SUBJECT
router.delete('/subjects/:subjectId/students/:studentId', verifyToken, async (req, res) => {
  try {
    const { subjectId, studentId } = req.params;
    const teacherId = req.user.id;
    const connection = await pool.getConnection();

    const [subjects] = await connection.query(
      'SELECT id FROM subjects WHERE id = ? AND teacher_id = ?',
      [subjectId, teacherId]
    );

    if (subjects.length === 0) {
      connection.release();
      return res.status(403).json({ success: false, error: 'You do not have permission to access this subject' });
    }

    await connection.query(
      'DELETE FROM subject_students WHERE subject_id = ? AND student_id = ?',
      [subjectId, studentId]
    );

    connection.release();
    res.json({ success: true, message: 'Student unenrolled successfully' });
  } catch (err) {
    console.error('Error unenrolling student:', err);
    res.status(500).json({ success: false, error: 'Failed to unenroll student', message: err.message });
  }
});

// GET SUBJECT STUDENTS (enrolled)
router.get('/subjects/:subjectId/students', verifyToken, async (req, res) => {
  try {
    const { subjectId } = req.params;
    const teacherId = req.user.id;
    const connection = await pool.getConnection();

    const [subjects] = await connection.query(
      'SELECT id, class_id FROM subjects WHERE id = ? AND teacher_id = ?',
      [subjectId, teacherId]
    );

    if (subjects.length === 0) {
      connection.release();
      return res.status(403).json({ success: false, error: 'You do not have permission to access this subject' });
    }

    const [students] = await connection.query(
      `SELECT s.id, s.name, s.email, s.roll_number, s.enrollment_date
       FROM subject_students ss
       JOIN students s ON ss.student_id = s.id
       WHERE ss.subject_id = ?
       ORDER BY s.name ASC`,
      [subjectId]
    );

    connection.release();
    res.json({ success: true, students });
  } catch (err) {
    console.error('Error fetching subject students:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch subject students', message: err.message });
  }
});

// ENROLL EXISTING CLASS STUDENT INTO SUBJECT
router.post('/subjects/:subjectId/students', verifyToken, async (req, res) => {
  try {
    const { subjectId } = req.params;
    const teacherId = req.user.id;
    const { student_id } = req.body;

    if (!student_id) {
      return res.status(400).json({ success: false, error: 'student_id is required' });
    }

    const connection = await pool.getConnection();

    const [subjects] = await connection.query(
      'SELECT id, class_id FROM subjects WHERE id = ? AND teacher_id = ?',
      [subjectId, teacherId]
    );

    if (subjects.length === 0) {
      connection.release();
      return res.status(403).json({ success: false, error: 'You do not have permission to access this subject' });
    }

    const classId = subjects[0].class_id;
    const [students] = await connection.query(
      'SELECT id FROM students WHERE id = ? AND class_id = ?',
      [student_id, classId]
    );

    if (students.length === 0) {
      connection.release();
      return res.status(400).json({ success: false, error: 'Student does not belong to this class' });
    }

    await connection.query(
      'INSERT IGNORE INTO subject_students (subject_id, student_id) VALUES (?, ?)',
      [subjectId, student_id]
    );

    connection.release();
    res.json({ success: true, message: 'Student enrolled successfully' });
  } catch (err) {
    console.error('Error enrolling student:', err);
    res.status(500).json({ success: false, error: 'Failed to enroll student', message: err.message });
  }
});

// COPY OR MOVE STUDENT ENROLLMENT BETWEEN SUBJECTS
router.post('/subjects/:subjectId/students/transfer', verifyToken, async (req, res) => {
  try {
    const { subjectId } = req.params;
    const teacherId = req.user.id;
    const { student_id, target_subject_id, mode } = req.body;

    if (!student_id || !target_subject_id) {
      return res.status(400).json({ success: false, error: 'student_id and target_subject_id are required' });
    }

    const transferMode = (mode || 'copy').toLowerCase();
    if (transferMode !== 'copy' && transferMode !== 'move') {
      return res.status(400).json({ success: false, error: "mode must be 'copy' or 'move'" });
    }

    const connection = await pool.getConnection();

    const [source] = await connection.query(
      'SELECT id, class_id FROM subjects WHERE id = ? AND teacher_id = ?',
      [subjectId, teacherId]
    );

    const [target] = await connection.query(
      'SELECT id, class_id FROM subjects WHERE id = ? AND teacher_id = ?',
      [target_subject_id, teacherId]
    );

    if (source.length === 0 || target.length === 0) {
      connection.release();
      return res.status(403).json({ success: false, error: 'You do not have permission to access one of the subjects' });
    }

    if (Number(source[0].class_id) !== Number(target[0].class_id)) {
      connection.release();
      return res.status(400).json({ success: false, error: 'Subjects must belong to the same class' });
    }

    // Ensure enrollment exists in source for move (and for copy we allow copying even if not enrolled)
    if (transferMode === 'move') {
      const [enroll] = await connection.query(
        'SELECT id FROM subject_students WHERE subject_id = ? AND student_id = ?',
        [subjectId, student_id]
      );
      if (enroll.length === 0) {
        connection.release();
        return res.status(400).json({ success: false, error: 'Student is not enrolled in the source subject' });
      }
    }

    await connection.query(
      'INSERT IGNORE INTO subject_students (subject_id, student_id) VALUES (?, ?)',
      [target_subject_id, student_id]
    );

    if (transferMode === 'move') {
      await connection.query(
        'DELETE FROM subject_students WHERE subject_id = ? AND student_id = ?',
        [subjectId, student_id]
      );
    }

    connection.release();
    res.json({ success: true, message: `Enrollment ${transferMode}d successfully` });
  } catch (err) {
    console.error('Error transferring enrollment:', err);
    res.status(500).json({ success: false, error: 'Failed to transfer enrollment', message: err.message });
  }
});

// GET TEACHER DASHBOARD DATA
router.get('/dashboard', verifyToken, async (req, res) => {
  try {
    if (req.user.userType !== 'teacher' && req.user.userType !== 'school') {
      return res.status(403).json({ error: 'Access denied. Teachers only.' });
    }

    const teacherId = req.user.id;
    const CACHE_TTL_MS = 120000; // 2 minutes

    // Check cache first
    const cached = teacherDashboardCache.get(String(teacherId));
    const now = Date.now();
    if (cached && (now - cached.timestamp) < CACHE_TTL_MS) {
      return res.json({
        success: true,
        data: cached.data,
        cached: true,
        responseTimeMs: now - cached.timestamp
      });
    }

    const connection = await pool.getConnection();

    // Get teacher's classes
    const [classes] = await connection.query(
      'SELECT id, name, grade_level, student_count FROM classes WHERE teacher_id = ?',
      [teacherId]
    );

    // Get total students
    const [studentCount] = await connection.query(
      `SELECT COUNT(s.id) as total_students 
       FROM students s 
       JOIN classes c ON s.class_id = c.id 
       WHERE c.teacher_id = ?`,
      [teacherId]
    );

    // Get total subjects
    const [subjectCount] = await connection.query(
      `SELECT COUNT(s.id) as total_subjects 
       FROM subjects s 
       JOIN classes c ON s.class_id = c.id 
       WHERE c.teacher_id = ?`,
      [teacherId]
    );

    // Get recent exams
    const [recentExams] = await connection.query(
      `SELECT e.id, e.title, c.name as class_name, s.name as subject_name, e.exam_date
       FROM exams e
       JOIN classes c ON e.class_id = c.id
       JOIN subjects s ON e.subject_id = s.id
       WHERE e.created_by = ?
       ORDER BY e.exam_date DESC
       LIMIT 5`,
      [teacherId]
    );

    // Get class performance
    const [classPerformance] = await connection.query(
      `SELECT 
        c.id,
        c.name,
        COUNT(DISTINCT s.id) as student_count,
        ROUND(AVG(er.percentage), 2) as average_score,
        MAX(er.percentage) as highest_score,
        MIN(er.percentage) as lowest_score
       FROM classes c
       LEFT JOIN students s ON c.id = s.class_id
       LEFT JOIN exam_results er ON s.id = er.student_id
       WHERE c.teacher_id = ?
       GROUP BY c.id, c.name`,
      [teacherId]
    );

    // Get average score
    const [avgScore] = await connection.query(
      `SELECT ROUND(AVG(er.percentage), 2) as average_score
       FROM exam_results er
       JOIN exams e ON er.exam_id = e.id
       WHERE e.created_by = ?`,
      [teacherId]
    );

    connection.release();

    const responseData = {
      totalClasses: classes.length,
      totalStudents: studentCount[0].total_students || 0,
      totalSubjects: subjectCount[0].total_subjects || 0,
      averageScore: avgScore[0].average_score || 0,
      classes,
      recentExams,
      classPerformance
    };

    // Update cache
    teacherDashboardCache.set(String(teacherId), {
      data: responseData,
      timestamp: Date.now()
    });

    res.json({
      success: true,
      data: responseData,
      cached: false
    });

  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Failed to fetch dashboard data', message: err.message });
  }
});

// GET TEACHER CLASSES
router.get('/classes', verifyToken, async (req, res) => {
  try {
    const teacherId = req.user.id;
    const CACHE_TTL_MS = 120000; // 2 minutes

    // Check cache first
    const cached = teacherClassesCache.get(String(teacherId));
    const now = Date.now();
    if (cached && (now - cached.timestamp) < CACHE_TTL_MS) {
      return res.json({
        success: true,
        classes: cached.data,
        cached: true
      });
    }

    const connection = await pool.getConnection();

    const [classes] = await connection.query(
      `SELECT c.id, c.name, c.grade_level, COUNT(s.id) as student_count
       FROM classes c
       LEFT JOIN students s ON c.id = s.class_id
       WHERE c.teacher_id = ?
       GROUP BY c.id, c.name, c.grade_level`,
      [teacherId]
    );

    connection.release();

    // Update cache
    teacherClassesCache.set(String(teacherId), {
      data: classes,
      timestamp: Date.now()
    });

    res.json({
      success: true,
      classes,
      cached: false
    });

  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch classes', message: err.message });
  }
});

// GET TEACHER SUBJECTS
router.get('/subjects/:classId', verifyToken, async (req, res) => {
  try {
    const { classId } = req.params;
    const teacherId = req.user.id;
    const connection = await pool.getConnection();

    const [subjects] = await connection.query(
      `SELECT s.id, s.name, s.code, COUNT(q.id) as question_count
       FROM subjects s
       LEFT JOIN questions q ON s.id = q.subject_id
       WHERE s.class_id = ? AND s.teacher_id = ?
       GROUP BY s.id, s.name, s.code`,
      [classId, teacherId]
    );

    connection.release();

    res.json({
      success: true,
      subjects
    });

  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch subjects', message: err.message });
  }
});

// CREATE SUBJECT
router.post('/subjects', verifyToken, async (req, res) => {
  try {
    const teacherId = req.user.id;
    const { name, code, class_id, description, total_marks } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Subject name is required' });
    }

    if (!class_id) {
      return res.status(400).json({ success: false, error: 'class_id is required' });
    }

    const connection = await pool.getConnection();

    const [classes] = await connection.query(
      'SELECT id FROM classes WHERE id = ? AND teacher_id = ?',
      [class_id, teacherId]
    );

    if (classes.length === 0) {
      connection.release();
      return res.status(403).json({ success: false, error: 'You do not have permission to add subjects to this class' });
    }

    const [result] = await connection.query(
      `INSERT INTO subjects (name, code, class_id, teacher_id, description, total_marks)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        name.trim(),
        (code || '').trim() || null,
        Number(class_id),
        teacherId,
        (description || '').trim() || null,
        total_marks !== undefined && total_marks !== null && `${total_marks}`.trim() !== ''
          ? Number(total_marks)
          : 100
      ]
    );

    const newSubject = {
      id: result.insertId,
      name: name.trim(),
      code: (code || '').trim() || null,
      class_id: Number(class_id),
      teacher_id: teacherId,
      description: (description || '').trim() || null,
      total_marks: total_marks !== undefined && total_marks !== null && `${total_marks}`.trim() !== ''
        ? Number(total_marks)
        : 100
    };

    connection.release();

    res.json({
      success: true,
      subject: newSubject,
      message: 'Subject created successfully'
    });
  } catch (err) {
    console.error('Error creating subject:', err);
    res.status(500).json({ success: false, error: 'Failed to create subject', message: err.message });
  }
});

// DELETE SUBJECT
router.delete('/subjects/:subjectId', verifyToken, async (req, res) => {
  try {
    const teacherId = req.user.id;
    const { subjectId } = req.params;
    const connection = await pool.getConnection();

    const [subjects] = await connection.query(
      'SELECT id FROM subjects WHERE id = ? AND teacher_id = ?',
      [subjectId, teacherId]
    );

    if (subjects.length === 0) {
      connection.release();
      return res.status(403).json({ success: false, error: 'You do not have permission to delete this subject' });
    }

    await connection.query('DELETE FROM subjects WHERE id = ?', [subjectId]);
    connection.release();

    res.json({
      success: true,
      message: 'Subject deleted successfully'
    });
  } catch (err) {
    console.error('Error deleting subject:', err);
    res.status(500).json({ success: false, error: 'Failed to delete subject', message: err.message });
  }
});

// CREATE A NEW CLASS
router.post('/create-class', verifyToken, async (req, res) => {
  try {
    const { name, grade_level } = req.body;
    const teacherId = req.user.id;
    const connection = await pool.getConnection();

    if (!name || !name.trim()) {
      connection.release();
      return res.status(400).json({ error: 'Class name is required' });
    }

    // Get teacher's current school_id
    const [teacher] = await connection.query(
      'SELECT school_id FROM users WHERE id = ?',
      [teacherId]
    );

    let schoolId = teacher[0]?.school_id || null;

    // If teacher doesn't have a school_id, assign them to a default school
    if (!schoolId) {
      console.log('⚠️ Teacher has no school assigned, creating/assigning default school...');
      
      // Try to find an existing school
      const [schools] = await connection.query('SELECT id FROM schools LIMIT 1');
      
      if (schools.length > 0) {
        schoolId = schools[0].id;
        console.log('✅ Assigning teacher to existing school:', schoolId);
      } else {
        // Create a default school
        const [newSchool] = await connection.query(
          'INSERT INTO schools (name) VALUES (?)',
          ['Default School']
        );
        schoolId = newSchool.insertId;
        console.log('✅ Created default school:', schoolId);
      }

      // Update teacher's school_id
      await connection.query(
        'UPDATE users SET school_id = ? WHERE id = ?',
        [schoolId, teacherId]
      );
      console.log('✅ Updated teacher school_id to:', schoolId);
    }

    if (!schoolId) {
      connection.release();
      return res.status(500).json({
        success: false,
        error: 'Failed to resolve a valid school_id for this teacher'
      });
    }

    const [result] = await connection.query(
      `INSERT INTO classes (name, grade_level, teacher_id, school_id) 
       VALUES (?, ?, ?, ?)`,
      [name, grade_level || null, teacherId, Number(schoolId)]
    );

    const newClass = {
      id: result.insertId,
      name,
      grade_level: grade_level || null,
      student_count: 0,
      subjects: []
    };

    connection.release();

    res.json({
      success: true,
      class: newClass,
      message: 'Class created successfully'
    });

  } catch (err) {
    console.error('Error creating class:', err);
    res.status(500).json({ error: 'Failed to create class', message: err.message });
  }
});

// DELETE A CLASS
router.delete('/classes/:classId', verifyToken, async (req, res) => {
  try {
    const { classId } = req.params;
    const teacherId = req.user.id;
    const connection = await pool.getConnection();

    // Verify that the class belongs to the teacher
    const [classes] = await connection.query(
      'SELECT id FROM classes WHERE id = ? AND teacher_id = ?',
      [classId, teacherId]
    );

    if (classes.length === 0) {
      connection.release();
      return res.status(403).json({ error: 'You do not have permission to delete this class' });
    }

    // Delete the class (cascade delete will handle students, subjects, etc.)
    await connection.query('DELETE FROM classes WHERE id = ?', [classId]);

    connection.release();

    res.json({
      success: true,
      message: 'Class deleted successfully'
    });

  } catch (err) {
    console.error('Error deleting class:', err);
    res.status(500).json({ error: 'Failed to delete class', message: err.message });
  }
});

// GET CLASS STUDENTS
router.get('/classes/:classId/students', verifyToken, async (req, res) => {
  try {
    const { classId } = req.params;
    const teacherId = req.user.id;
    const connection = await pool.getConnection();

    // Verify the class belongs to the teacher
    const [classes] = await connection.query(
      'SELECT id FROM classes WHERE id = ? AND teacher_id = ?',
      [classId, teacherId]
    );

    if (classes.length === 0) {
      connection.release();
      return res.status(403).json({ error: 'You do not have permission to access this class' });
    }

    const [students] = await connection.query(
      `SELECT s.id, s.name, s.email, s.roll_number, s.enrollment_date
       FROM students s
       WHERE s.class_id = ?
       ORDER BY s.name ASC`,
      [classId]
    );

    connection.release();

    res.json({
      success: true,
      students
    });

  } catch (err) {
    console.error('Error fetching class students:', err);
    res.status(500).json({ error: 'Failed to fetch class students', message: err.message });
  }
});

// UPDATE TEACHER PROFILE
router.post('/update-profile', verifyToken, async (req, res) => {
  try {
    if (req.user.userType !== 'teacher' && req.user.userType !== 'school') {
      return res.status(403).json({ error: 'Access denied. Teachers only.' });
    }

    const teacherId = req.user.id;
    const { name, email, schoolId, bio } = req.body;

    if (!name && !email && !schoolId && !bio) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const connection = await pool.getConnection();

    // Build dynamic update query
    const updateFields = [];
    const updateValues = [];

    if (name) {
      updateFields.push('name = ?');
      updateValues.push(name);
    }
    if (email) {
      updateFields.push('email = ?');
      updateValues.push(email);
    }
    if (schoolId !== undefined && schoolId !== null && `${schoolId}`.trim() !== '') {
      const schoolIdNum = Number(`${schoolId}`.trim());
      if (Number.isNaN(schoolIdNum) || schoolIdNum <= 0) {
        connection.release();
        return res.status(400).json({ error: 'School ID must be a valid number' });
      }

      // Validate that the school exists; if not, auto-create a school record
      const [schools] = await connection.query(
        'SELECT id FROM schools WHERE id = ?',
        [schoolIdNum]
      );

      let resolvedSchoolId = schoolIdNum;
      if (schools.length === 0) {
        const [newSchool] = await connection.query(
          'INSERT INTO schools (name) VALUES (?)',
          [`School ${schoolIdNum}`]
        );
        resolvedSchoolId = newSchool.insertId;
      }

      updateFields.push('school_id = ?');
      updateValues.push(resolvedSchoolId);
    }
    if (bio) {
      updateFields.push('bio = ?');
      updateValues.push(bio);
    }

    updateValues.push(teacherId);

    // Execute update query
    const updateQuery = `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`;
    await connection.query(updateQuery, updateValues);

    connection.release();

    res.json({
      success: true,
      message: 'Profile updated successfully',
      teacherId: teacherId
    });

  } catch (err) {
    console.error('Error updating profile:', err);
    res.status(500).json({ error: 'Failed to update profile', message: err.message });
  }
});

module.exports = router;
