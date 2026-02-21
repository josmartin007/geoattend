const express = require('express');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
const PORT = 3000;
const SECRET_KEY = 'geoattend-secret-2024';

app.use(cors());
app.use(express.json());

require('dotenv').config();
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,    waitForConnections: true,
    connectionLimit: 10
});

// Store active geo sessions in memory
const activeSessions = new Map();

pool.getConnection()
    .then(conn => {
        console.log('✅ Database connected!');
        conn.release();
    })
    .catch(err => {
        console.error('❌ Database error:', err.message);
    });

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'No token' });
    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.status(403).json({ message: 'Invalid token' });
        req.user = user;
        next();
    });
}

// ================== LOGIN ==================
app.post('/api/auth/login', async (req, res) => {
    const { username, password, role } = req.body;
    console.log('Login:', username, role);
    
    try {
        const [users] = await pool.query(
            'SELECT * FROM users WHERE username = ? AND role = ?',
            [username, role]
        );
        
        if (users.length === 0) {
            return res.status(401).json({ success: false, message: 'User not found' });
        }
        
        const user = users[0];
        if (password !== user.password) {
            return res.status(401).json({ success: false, message: 'Wrong password' });
        }
        
        const token = jwt.sign({ id: user.id, role: user.role }, SECRET_KEY, { expiresIn: '24h' });
        console.log('✅ Login OK:', user.name);
        res.json({
            success: true,
            token,
            user: { 
                id: user.id, 
                name: user.name, 
                role: user.role, 
                roll_number: user.roll_number,
                department_id: user.department_id,
                semester: user.semester
            }
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ================== GEO-SESSION ENDPOINTS ==================

// Teacher: Start a geo-fenced attendance session
app.post('/api/teacher/geo-session/start', authenticateToken, async (req, res) => {
    const { subjectId, classId, departmentId, semester } = req.body;
    const teacherId = req.user.id;
    
    try {
        const [classInfo] = await pool.query('SELECT * FROM classes WHERE id = ?', [classId]);
        if (classInfo.length === 0) {
            return res.status(404).json({ success: false, message: 'Class not found' });
        }
        
        const [students] = await pool.query(
            `SELECT id, name, roll_number FROM users 
             WHERE role = 'student' AND department_id = ? AND semester = ?
             ORDER BY roll_number`,
            [departmentId, semester]
        );
        
        const sessionId = `session_${Date.now()}_${teacherId}`;
        const sessionStartTime = new Date();
        
        const session = {
            id: sessionId,
            teacherId,
            subjectId,
            classId,
            departmentId,
            semester,
            classInfo: classInfo[0],
            sessionStartTime: sessionStartTime, // Store session start time
            students: students.map(s => ({
                id: s.id,
                name: s.name,
                roll_number: s.roll_number,
                status: 'unmarked',
                markedAt: null,
                markedBy: null
            })),
            startedAt: sessionStartTime,
            active: true
        };
        
        activeSessions.set(sessionId, session);
        console.log(`📍 Geo-session started: ${sessionId} at ${sessionStartTime.toLocaleTimeString()}`);
        res.json({ success: true, sessionId, session });
        
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Student: Auto check-in when entering geo-fence
app.post('/api/student/geo-checkin', authenticateToken, async (req, res) => {
    const { latitude, longitude } = req.body;
    const studentId = req.user.id;
    
    try {
        let checkedIn = [];
        let alreadyMarked = [];
        
        for (const [sessionId, session] of activeSessions.entries()) {
            if (!session.active) continue;
            
            const student = session.students.find(s => s.id === studentId);
            if (!student) continue;
            
            // Check if already marked
            if (student.status !== 'unmarked') {
                // Get subject and teacher info
                const [subjectInfo] = await pool.query('SELECT name FROM subjects WHERE id = ?', [session.subjectId]);
                const [teacherInfo] = await pool.query('SELECT name FROM users WHERE id = ?', [session.teacherId]);
                
                alreadyMarked.push({
                    sessionId,
                    subjectId: session.subjectId,
                    subjectName: subjectInfo[0]?.name || 'Unknown',
                    teacherName: teacherInfo[0]?.name || 'Unknown',
                    status: student.status,
                    markedBy: student.markedBy,
                    message: student.markedBy === 'manual' 
                        ? `Teacher marked you as ${student.status}` 
                        : `Already checked in as ${student.status}`
                });
                continue;
            }
            
            const distance = calculateDistance(
                latitude, longitude, 
                session.classInfo.latitude, 
                session.classInfo.longitude
            );
            
            if (distance <= session.classInfo.geo_radius) {
                student.status = 'present';
                student.markedAt = new Date();
                student.markedBy = 'geo-auto';
                
                // Get subject and teacher info
                const [subjectInfo] = await pool.query('SELECT name FROM subjects WHERE id = ?', [session.subjectId]);
                const [teacherInfo] = await pool.query('SELECT name FROM users WHERE id = ?', [session.teacherId]);
                
                checkedIn.push({
                    sessionId,
                    subjectId: session.subjectId,
                    subjectName: subjectInfo[0]?.name || 'Unknown',
                    teacherName: teacherInfo[0]?.name || 'Unknown',
                    distance: Math.round(distance)
                });
                
                console.log(`✅ Auto check-in: ${student.name} (${Math.round(distance)}m) - ${subjectInfo[0]?.name}`);
            }
        }
        
        res.json({ 
            success: true, 
            checkedIn,
            alreadyMarked,
            message: checkedIn.length > 0 
                ? `Checked in to ${checkedIn.length} session(s)` 
                : alreadyMarked.length > 0 
                    ? 'Attendance already marked' 
                    : 'No active sessions in range'
        });
        
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
// Teacher: Get live session status
app.get('/api/teacher/geo-session/:sessionId', authenticateToken, async (req, res) => {
    const { sessionId } = req.params;
    
    const session = activeSessions.get(sessionId);
    if (!session) {
        return res.status(404).json({ success: false, message: 'Session not found' });
    }
    
    const present = session.students.filter(s => s.status === 'present').length;
    const absent = session.students.filter(s => s.status === 'absent').length;
    const unmarked = session.students.filter(s => s.status === 'unmarked').length;
    
    res.json({
        success: true,
        session: {
            ...session,
            stats: { present, absent, unmarked, total: session.students.length }
        }
    });
});

// Teacher: Manually mark student in geo-session
app.post('/api/teacher/geo-session/mark-manual', authenticateToken, async (req, res) => {
    const { sessionId, studentId, status } = req.body;
    
    const session = activeSessions.get(sessionId);
    if (!session) {
        return res.status(404).json({ success: false, message: 'Session not found' });
    }
    
    const student = session.students.find(s => s.id === studentId);
    if (!student) {
        return res.status(404).json({ success: false, message: 'Student not found in session' });
    }
    
    student.status = status;
    student.markedAt = new Date();
    student.markedBy = 'manual';
    
    console.log(`✍️ Manual mark: ${student.name} - ${status}`);
    res.json({ success: true, student });
});

// Teacher: End geo-session and save to database
app.post('/api/teacher/geo-session/end', authenticateToken, async (req, res) => {
    const { sessionId } = req.body;
    const teacherId = req.user.id;
    
    const session = activeSessions.get(sessionId);
    if (!session) {
        return res.status(404).json({ success: false, message: 'Session not found' });
    }
    
    try {
        const connection = await pool.getConnection();
        await connection.beginTransaction();
        
        try {
            // Save all attendance records with session start time
            // This allows multiple sessions per day for the same subject
           // Save all attendance records - mark unmarked students as absent
for (const student of session.students) {
    let finalStatus = student.status;
    
    // NEW: If student is still unmarked, mark as absent
    if (finalStatus === 'unmarked') {
        finalStatus = 'absent';
        student.status = 'absent';
        student.markedAt = new Date();
        student.markedBy = 'auto-absent';
        console.log(`⚠️ Auto-marked absent: ${student.name} (unmarked at session end)`);
    }
    
    // Check if already marked in THIS specific session (within 5 minutes window)
    const [existing] = await connection.query(
        `SELECT id FROM attendance 
         WHERE student_id = ? 
         AND subject_id = ? 
         AND class_id = ?
         AND DATE(marked_at) = CURDATE()
         AND ABS(TIMESTAMPDIFF(MINUTE, marked_at, ?)) < 5`,
        [student.id, session.subjectId, session.classId, session.sessionStartTime]
    );
    
    if (existing.length === 0) {
        // Insert attendance record
        await connection.query(
            `INSERT INTO attendance 
             (student_id, subject_id, class_id, status, marked_by, marked_at) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                student.id, 
                session.subjectId, 
                session.classId, 
                finalStatus,
                teacherId,
                student.markedAt || session.sessionStartTime
            ]
        );
        
        const statusIcon = finalStatus === 'present' ? '💾' : '⚠️';
        console.log(`${statusIcon} Saved: ${student.name} - ${finalStatus}`);
    } else {
        console.log(`⚠️ Already marked: ${student.name} (skipped duplicate)`);
    }
}            
            await connection.commit();
            connection.release();
            
            session.active = false;
            activeSessions.delete(sessionId);
            
            console.log(`🏁 Session ended: ${sessionId}`);
            res.json({ success: true, message: 'Session ended and attendance saved' });
            
        } catch (error) {
            await connection.rollback();
            connection.release();
            throw error;
        }
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Student: Get active sessions with full details (subject name, teacher name, status)
app.get('/api/student/active-sessions', authenticateToken, async (req, res) => {
    const studentId = req.user.id;
    
    const studentSessions = [];
    for (const [sessionId, session] of activeSessions.entries()) {
        if (!session.active) continue;
        
        const student = session.students.find(s => s.id === studentId);
        if (student) {
            try {
                // Get subject and teacher details
                const [subjectInfo] = await pool.query(`
                    SELECT s.name as subject_name, s.code as subject_code
                    FROM subjects s
                    WHERE s.id = ?
                `, [session.subjectId]);
                
                const [teacherInfo] = await pool.query(`
                    SELECT name as teacher_name
                    FROM users
                    WHERE id = ?
                `, [session.teacherId]);
                
                studentSessions.push({
                    sessionId,
                    subjectId: session.subjectId,
                    subjectName: subjectInfo[0]?.subject_name || 'Unknown Subject',
                    subjectCode: subjectInfo[0]?.subject_code || '',
                    teacherName: teacherInfo[0]?.teacher_name || 'Unknown Teacher',
                    classInfo: session.classInfo,
                    status: student.status,
                    markedAt: student.markedAt,
                    markedBy: student.markedBy
                });
            } catch (error) {
                console.error('Error fetching session details:', error);
            }
        }
    }
    
    res.json({ success: true, sessions: studentSessions });
});
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ================== ADMIN ENDPOINTS ==================
app.get('/api/admin/dashboard/stats', authenticateToken, async (req, res) => {
    try {
        const [s] = await pool.query("SELECT COUNT(*) as c FROM users WHERE role = 'student'");
        const [t] = await pool.query("SELECT COUNT(*) as c FROM users WHERE role = 'teacher'");
        const [d] = await pool.query("SELECT COUNT(*) as c FROM departments");
        const [a] = await pool.query("SELECT ROUND(AVG(CASE WHEN status = 'present' THEN 100 ELSE 0 END), 1) as avg FROM attendance");
        res.json({ totalStudents: s[0].c, totalTeachers: t[0].c, totalDepartments: d[0].c, avgAttendance: a[0].avg || 0 });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/admin/attendance/logs', authenticateToken, async (req, res) => {
    try {
        const [logs] = await pool.query(`
            SELECT u.name as studentName, u.roll_number, sub.name as subjectName,
                   DATE_FORMAT(a.marked_at, '%h:%i %p') as time, a.status
            FROM attendance a
            JOIN users u ON a.student_id = u.id
            JOIN subjects sub ON a.subject_id = sub.id
            ORDER BY a.marked_at DESC LIMIT 20
        `);
        res.json(logs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/admin/departments', authenticateToken, async (req, res) => {
    try {
        const [depts] = await pool.query('SELECT * FROM departments ORDER BY program_type, name');
        res.json(depts);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/admin/departments', authenticateToken, async (req, res) => {
    const { name, code, program_type } = req.body;
    try {
        await pool.query('INSERT INTO departments (name, code, program_type) VALUES (?, ?, ?)', [name, code, program_type]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/admin/departments/:id', authenticateToken, async (req, res) => {
    try {
        await pool.query('DELETE FROM departments WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/admin/users', authenticateToken, async (req, res) => {
    try {
        const [users] = await pool.query(`
            SELECT u.*, d.name as dept_name 
            FROM users u 
            LEFT JOIN departments d ON u.department_id = d.id 
            ORDER BY u.role, u.name
        `);
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/admin/users', authenticateToken, async (req, res) => {
    const { name, username, password, role, department_id, roll_number, semester, year, subject_ids } = req.body;
    try {
        const [result] = await pool.query(
            'INSERT INTO users (name, username, password, role, department_id, roll_number, semester, year) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [name, username, password, role, department_id, roll_number, semester, year]
        );
        if (role === 'teacher' && subject_ids && subject_ids.length > 0) {
            const userId = result.insertId;
            for (let subjectId of subject_ids) {
                await pool.query('INSERT INTO teacher_subjects (teacher_id, subject_id) VALUES (?, ?)', [userId, subjectId]);
            }
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/admin/users/:id', authenticateToken, async (req, res) => {
    try {
        await pool.query('DELETE FROM users WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/admin/subjects', authenticateToken, async (req, res) => {
    try {
        const [subjects] = await pool.query(`
            SELECT s.*, d.name as dept_name,
                   GROUP_CONCAT(u.name SEPARATOR ', ') as teacher_names
            FROM subjects s
            LEFT JOIN departments d ON s.department_id = d.id
            LEFT JOIN teacher_subjects ts ON s.id = ts.subject_id
            LEFT JOIN users u ON ts.teacher_id = u.id
            GROUP BY s.id
            ORDER BY s.name
        `);
        res.json(subjects);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/admin/subjects', authenticateToken, async (req, res) => {
    const { name, code, department_id, semester, teacher_ids } = req.body;
    try {
        const [result] = await pool.query(
            'INSERT INTO subjects (name, code, department_id, semester) VALUES (?, ?, ?, ?)',
            [name, code, department_id, semester]
        );
        if (teacher_ids && teacher_ids.length > 0) {
            const subjectId = result.insertId;
            for (let teacherId of teacher_ids) {
                await pool.query('INSERT INTO teacher_subjects (teacher_id, subject_id) VALUES (?, ?)', [teacherId, subjectId]);
            }
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/admin/subjects/:id', authenticateToken, async (req, res) => {
    try {
        await pool.query('DELETE FROM subjects WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/admin/classes', authenticateToken, async (req, res) => {
    try {
        const [classes] = await pool.query('SELECT * FROM classes ORDER BY building, name');
        res.json(classes);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/admin/classes', authenticateToken, async (req, res) => {
    const { name, code, building, room_number, latitude, longitude, geo_radius } = req.body;
    try {
        await pool.query('INSERT INTO classes (name, code, building, room_number, latitude, longitude, geo_radius) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [name, code, building, room_number, latitude, longitude, geo_radius]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/admin/classes/:id', authenticateToken, async (req, res) => {
    const { name, code, building, room_number, latitude, longitude, geo_radius } = req.body;
    try {
        await pool.query(
            'UPDATE classes SET name=?, code=?, building=?, room_number=?, latitude=?, longitude=?, geo_radius=? WHERE id=?',
            [name, code, building, room_number, latitude, longitude, geo_radius, req.params.id]
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/admin/classes/:id', authenticateToken, async (req, res) => {
    try {
        await pool.query('DELETE FROM classes WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ================== ADMIN PUT ENDPOINTS (EDIT FUNCTIONALITY) ==================

// Update Department
app.put('/api/admin/departments/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { name, code, program_type } = req.body;
    try {
        await pool.query(
            'UPDATE departments SET name = ?, code = ?, program_type = ? WHERE id = ?',
            [name, code, program_type, id]
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update User
app.put('/api/admin/users/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { name, username, password, role, department_id, roll_number, semester, year, subject_ids } = req.body;
    try {
        let query = 'UPDATE users SET name = ?, username = ?, role = ?, department_id = ?, roll_number = ?, semester = ?, year = ?';
        let params = [name, username, role, department_id, roll_number, semester, year];
        
        if (password) {
            query += ', password = ?';
            params.push(password);
        }
        
        query += ' WHERE id = ?';
        params.push(id);
        
        await pool.query(query, params);
        
        if (role === 'teacher' && subject_ids) {
            await pool.query('DELETE FROM teacher_subjects WHERE teacher_id = ?', [id]);
            if (subject_ids.length > 0) {
                for (let subjectId of subject_ids) {
                    await pool.query('INSERT INTO teacher_subjects (teacher_id, subject_id) VALUES (?, ?)', [id, subjectId]);
                }
            }
        }
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update Subject
app.put('/api/admin/subjects/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { name, code, department_id, semester, teacher_ids } = req.body;
    try {
        await pool.query(
            'UPDATE subjects SET name = ?, code = ?, department_id = ?, semester = ? WHERE id = ?',
            [name, code, department_id, semester, id]
        );
        
        if (teacher_ids) {
            await pool.query('DELETE FROM teacher_subjects WHERE subject_id = ?', [id]);
            if (teacher_ids.length > 0) {
                for (let teacherId of teacher_ids) {
                    await pool.query('INSERT INTO teacher_subjects (teacher_id, subject_id) VALUES (?, ?)', [teacherId, id]);
                }
            }
        }
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Note: PUT for classes already exists in your code, but verify it's there

// ================== ATTENDANCE REPORTS ENDPOINT ==================

app.get('/api/admin/reports/department/:deptId', authenticateToken, async (req, res) => {
    try {
        const { deptId } = req.params;
        const { semester } = req.query;
        
        let query = `
            SELECT 
                u.roll_number,
                u.name as student_name,
                u.semester,
                s.name as subject_name,
                s.code as subject_code,
                COUNT(a.id) as total_classes,
                SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) as present_count,
                ROUND(SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) * 100.0 / COUNT(a.id), 2) as percentage
            FROM users u
            LEFT JOIN attendance a ON u.id = a.student_id
            LEFT JOIN subjects s ON a.subject_id = s.id
            WHERE u.role = 'student' AND u.department_id = ?
        `;
        
        const params = [deptId];
        
        if (semester) {
            query += ' AND u.semester = ?';
            params.push(semester);
        }
        
        query += ' GROUP BY u.id, s.id ORDER BY u.roll_number, s.name';
        
        const [report] = await pool.query(query, params);
        res.json(report);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// ================== STUDENT ENDPOINTS ==================
app.get('/api/student/dashboard', authenticateToken, async (req, res) => {
    try {
        const studentId = req.user.id;
        const [overview] = await pool.query(`
            SELECT COUNT(*) as total,
                   SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) as attended
            FROM attendance WHERE student_id = ?
        `, [studentId]);
        res.json({ overview: overview[0] || { total: 0, attended: 0 } });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/student/attendance/subject-wise', authenticateToken, async (req, res) => {
    try {
        const studentId = req.user.id;
        const [subjects] = await pool.query(`
            SELECT 
                s.id,
                s.name as subject_name,
                s.code as subject_code,
                COUNT(a.id) as total_classes,
                SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) as present_count,
                ROUND(SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) * 100.0 / COUNT(a.id), 2) as percentage
            FROM subjects s
            JOIN attendance a ON s.id = a.subject_id
            WHERE a.student_id = ?
            GROUP BY s.id
            ORDER BY s.name
        `, [studentId]);
        res.json(subjects);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ================== TEACHER ENDPOINTS ==================
app.get('/api/teacher/departments', authenticateToken, async (req, res) => {
    try {
        const type = req.query.type;
        const teacherId = req.user.id;
        const [depts] = await pool.query(`
            SELECT DISTINCT d.* 
            FROM departments d
            JOIN subjects s ON d.id = s.department_id
            JOIN teacher_subjects ts ON s.id = ts.subject_id
            WHERE d.program_type = ? AND ts.teacher_id = ?
            ORDER BY d.name
        `, [type, teacherId]);
        res.json(depts);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.get('/api/teacher/my-subjects', authenticateToken, async (req, res) => {
    try {
        const teacherId = req.user.id;
        
        const [subjects] = await pool.query(`
            SELECT 
                s.id as subject_id,
                s.name as subject_name,
                s.code as subject_code,
                s.semester,
                s.department_id as dept_id,
                d.name as dept_name,
                d.program_type
            FROM subjects s
            JOIN teacher_subjects ts ON s.id = ts.subject_id
            JOIN departments d ON s.department_id = d.id
            WHERE ts.teacher_id = ?
            ORDER BY d.program_type, s.semester, s.name
        `, [teacherId]);
        
        res.json(subjects);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/teacher/semesters', authenticateToken, async (req, res) => {
    try {
        const { deptId } = req.query;
        const teacherId = req.user.id;
        const [semesters] = await pool.query(`
            SELECT DISTINCT s.semester
            FROM subjects s
            JOIN teacher_subjects ts ON s.id = ts.subject_id
            WHERE s.department_id = ? AND ts.teacher_id = ? AND s.semester IS NOT NULL
            ORDER BY s.semester
        `, [deptId, teacherId]);
        res.json(semesters);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/teacher/subjects', authenticateToken, async (req, res) => {
    try {
        const deptId = req.query.deptId;
        const semester = req.query.semester;
        const teacherId = req.user.id;
        let query = `
            SELECT s.* FROM subjects s
            JOIN teacher_subjects ts ON s.id = ts.subject_id
            WHERE s.department_id = ? AND ts.teacher_id = ?
        `;
        const params = [deptId, teacherId];
        if (semester) {
            query += ' AND s.semester = ?';
            params.push(semester);
        }
        query += ' ORDER BY s.name';
        const [subjects] = await pool.query(query, params);
        res.json(subjects);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/teacher/classes', authenticateToken, async (req, res) => {
    try {
        const [classes] = await pool.query('SELECT * FROM classes ORDER BY name');
        res.json(classes);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/teacher/students', authenticateToken, async (req, res) => {
    try {
        const deptId = req.query.deptId;
        const semester = req.query.semester;
        let query = 'SELECT id, name, username, roll_number FROM users WHERE role = "student" AND department_id = ?';
        const params = [deptId];
        if (semester) {
            query += ' AND semester = ?';
            params.push(semester);
        }
        query += ' ORDER BY roll_number';
        const [students] = await pool.query(query, params);
        res.json(students);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/teacher/attendance/submit', authenticateToken, async (req, res) => {
    const { subjectId, classId, attendance } = req.body;
    try {
        const connection = await pool.getConnection();
        await connection.beginTransaction();
        try {
            const currentTime = new Date();
            for (const record of attendance) {
                // Check if already marked within last 2 hours (same session)
                const [existing] = await connection.query(`
                    SELECT id FROM attendance 
                    WHERE student_id = ? 
                    AND subject_id = ? 
                    AND class_id = ?
                    AND DATE(marked_at) = CURDATE()
                    AND ABS(TIMESTAMPDIFF(MINUTE, marked_at, ?)) < 5
                `, [record.studentId, subjectId, classId, currentTime]);
                
                if (existing.length === 0) {
                    await connection.query(
                        'INSERT INTO attendance (student_id, subject_id, class_id, status, marked_by) VALUES (?, ?, ?, ?, ?)',
                        [record.studentId, subjectId, classId, record.isPresent ? 'present' : 'absent', req.user.id]
                    );
                }
            }
            await connection.commit();
            connection.release();
            console.log('✅ Manual attendance submitted');
            res.json({ success: true });
        } catch (error) {
            await connection.rollback();
            connection.release();
            throw error;
        }
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
// ================== NEW: STUDENT ATTENDANCE HISTORY ==================
app.get('/api/student/attendance/history', authenticateToken, async (req, res) => {
    const studentId = req.user.id;
    const { startDate, endDate } = req.query;
    
    try {
        let query = `
            SELECT 
                a.id as attendance_id,
                a.marked_at,
                a.status,
                s.name as subject_name,
                s.code as subject_code,
                c.name as class_name,
                c.building,
                u.name as teacher_name
            FROM attendance a
            JOIN subjects s ON a.subject_id = s.id
            LEFT JOIN classes c ON a.class_id = c.id
            LEFT JOIN users u ON a.marked_by = u.id
            WHERE a.student_id = ?
        `;
        
        const params = [studentId];
        
        if (startDate && endDate) {
            query += ` AND DATE(a.marked_at) BETWEEN ? AND ?`;
            params.push(startDate, endDate);
        }
        
        query += ` ORDER BY a.marked_at DESC`;
        
        const [history] = await pool.query(query, params);
        res.json(history);
        
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ================== NEW: TEACHER ATTENDANCE RECORDS ==================
app.get('/api/teacher/attendance/records', authenticateToken, async (req, res) => {
    const teacherId = req.user.id;
    const { startDate, endDate, subjectId } = req.query;
    
    try {
        let query = `
            SELECT 
                a.id as attendance_id,
                a.marked_at,
                a.status,
                s.id as subject_id,
                s.name as subject_name,
                s.code as subject_code,
                u.id as student_id,
                u.name as student_name,
                u.roll_number,
                c.name as class_name,
                c.building
            FROM attendance a
            JOIN subjects s ON a.subject_id = s.id
            JOIN users u ON a.student_id = u.id
            LEFT JOIN classes c ON a.class_id = c.id
            JOIN teacher_subjects ts ON s.id = ts.subject_id
            WHERE ts.teacher_id = ? AND a.marked_by = ?
        `;
        
        const params = [teacherId, teacherId];
        
        if (startDate && endDate) {
            query += ` AND DATE(a.marked_at) BETWEEN ? AND ?`;
            params.push(startDate, endDate);
        }
        
        if (subjectId) {
            query += ` AND s.id = ?`;
            params.push(subjectId);
        }
        
        query += ` ORDER BY a.marked_at DESC`;
        
        const [records] = await pool.query(query, params);
        res.json(records);
        
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ================== NEW: UPDATE ATTENDANCE (BULK) ==================
app.post('/api/teacher/attendance/update-bulk', authenticateToken, async (req, res) => {
    const teacherId = req.user.id;
    const { updates } = req.body;
    
    if (!updates || !Array.isArray(updates) || updates.length === 0) {
        return res.status(400).json({ success: false, message: 'Invalid updates data' });
    }
    
    try {
        const connection = await pool.getConnection();
        await connection.beginTransaction();
        
        try {
            for (const update of updates) {
                // Verify teacher owns this attendance record
                const [check] = await connection.query(
                    `SELECT a.id FROM attendance a
                     JOIN subjects s ON a.subject_id = s.id
                     JOIN teacher_subjects ts ON s.id = ts.subject_id
                     WHERE a.id = ? AND ts.teacher_id = ?`,
                    [update.attendanceId, teacherId]
                );
                
                if (check.length === 0) {
                    throw new Error('Unauthorized to edit this attendance record');
                }
                
                // Update the record
                await connection.query(
                    'UPDATE attendance SET status = ? WHERE id = ?',
                    [update.status, update.attendanceId]
                );
            }
            
            await connection.commit();
            connection.release();
            
            console.log(`✅ Updated ${updates.length} attendance records`);
            res.json({ success: true, message: `${updates.length} records updated` });
            
        } catch (error) {
            await connection.rollback();
            connection.release();
            throw error;
        }
        
    } catch (error) {
        console.error('Update error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════╗
║  🚀 GeoAttend Server v3.1 Running!    ║
║  📡 Port: ${PORT}                            ║
║  🌐 http://localhost:${PORT}                ║
║  ✨ Multiple sessions per day support ║
╚═══════════════════════════════════════╝
    `);
    console.log('Users: admin/pass, student/pass, teacher/pass\n');
});