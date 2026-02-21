const API = 'http://localhost:3000/api';
let token, currentUser, currentRole;
let selectedProgram, selectedDepartment, selectedSemester, selectedSubject, selectedClass, selectedMode;
let currentSessionId = null, sessionInterval = null, autoCheckInterval = null, watchId = null;

function switchTab(role) {
    document.querySelectorAll('.login-form').forEach(f => f.classList.remove('active'));
    document.querySelectorAll('.tabs button').forEach(b => b.classList.remove('active'));
    document.getElementById(role + '-form').classList.add('active');
    event.target.classList.add('active');
}

function loading(show) { document.getElementById('loading').classList.toggle('show', show); }

async function api(endpoint, method, data) {
    const options = { method: method || 'GET', headers: { 'Content-Type': 'application/json' } };
    if (token) options.headers['Authorization'] = 'Bearer ' + token;
    if (data) options.body = JSON.stringify(data);
    const response = await fetch(API + endpoint, options);
    if (!response.ok) throw new Error(await response.text() || 'Failed');
    return await response.json();
}

async function login(role) {
    loading(true);
    try {
        const result = await api('/auth/login', 'POST', {
            username: document.getElementById(role + '-user').value,
            password: document.getElementById(role + '-pass').value,
            role: role
        });
        if (result.success) {
            token = result.token;
            currentUser = result.user;
            currentRole = role;
            document.getElementById('login-screen').style.display = 'none';
            if (role === 'student') { await loadStudent(); startAutoCheckIn(); }
            else if (role === 'teacher') await loadTeacher();
        }
    } catch (error) {
        alert('❌ Login failed: ' + error.message);
    } finally {
        loading(false);
    }
}

function logout() {
    if (sessionInterval) clearInterval(sessionInterval);
    if (autoCheckInterval) clearInterval(autoCheckInterval);
    if (watchId) navigator.geolocation.clearWatch(watchId);
    token = currentUser = currentRole = currentSessionId = null;
    document.querySelectorAll('.dashboard').forEach(d => { d.classList.remove('active'); d.innerHTML = ''; });
    document.getElementById('login-screen').style.display = 'flex';
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3, φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180, Δλ = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function filterStudents(query) {
    const search = query.toLowerCase();
    document.querySelectorAll('.student-item').forEach(item => {
        const name = item.getAttribute('data-name'), roll = item.getAttribute('data-roll');
        item.style.display = (name.includes(search) || roll.includes(search)) ? 'flex' : 'none';
    });
}

// STUDENT FUNCTIONS
async function loadStudent() {
    const dash = document.getElementById('student-dashboard');
    dash.classList.add('active');
    const rollBadge = currentUser.roll_number ? ` <span class="roll-number-badge">${currentUser.roll_number}</span>` : '';
    dash.innerHTML = `<header><div><h1><i class="fas fa-user-graduate"></i> Student Dashboard</h1><div class="user-info">Welcome, ${currentUser.name}${rollBadge}</div></div><button onclick="logout()"><i class="fas fa-sign-out-alt"></i> Logout</button></header><div class="content"><div id="auto-checkin-card" class="auto-checkin-status inactive"><div class="status-icon">📍</div><h3>Auto Check-in: Monitoring...</h3><p>Waiting for active sessions</p></div><div class="card"><h2>Overall Attendance</h2><div style="text-align:center;padding:20px;"><div style="font-size:52px;font-weight:bold;color:#667eea;" id="percent">0%</div><p style="font-size:18px;"><span id="attended">0</span> / <span id="total">0</span> classes</p></div></div><div class="card"><h2><i class="fas fa-chart-bar"></i> Subject-wise</h2><div id="subjects"></div></div></div>`;
    try {
        const data = await api('/student/dashboard');
        const percent = data.overview.total ? Math.round(data.overview.attended / data.overview.total * 100) : 0;
        document.getElementById('percent').textContent = percent + '%';
        document.getElementById('attended').textContent = data.overview.attended;
        document.getElementById('total').textContent = data.overview.total;
        const subData = await api('/student/attendance/subject-wise');
        document.getElementById('subjects').innerHTML = subData.length ? subData.map(s => `<div class="subject-card"><h3>${s.subject_name}</h3><div class="percentage">${s.percentage || 0}%</div><p>${s.present_count || 0} / ${s.total_classes || 0}</p></div>`).join('') : '<div class="alert alert-info">No records</div>';
    } catch (error) {
        console.error(error);
    }
}

function startAutoCheckIn() {
    if (navigator.geolocation) {
        watchId = navigator.geolocation.watchPosition(async (pos) => await checkAndMarkAttendance(pos.coords.latitude, pos.coords.longitude), (error) => updateCheckInStatus('❌ GPS Error', 'Enable GPS', 'inactive'), { enableHighAccuracy: true, timeout: 30000, maximumAge: 10000 });
        autoCheckInterval = setInterval(async () => {
            navigator.geolocation.getCurrentPosition(async (pos) => await checkAndMarkAttendance(pos.coords.latitude, pos.coords.longitude), null, { enableHighAccuracy: true });
        }, 30000);
    } else updateCheckInStatus('❌ No GPS', 'Device not supported', 'inactive');
}

async function checkAndMarkAttendance(latitude, longitude) {
    try {
        const { sessions } = await api('/student/active-sessions');
        if (!sessions.length) { updateCheckInStatus('⏳ Monitoring', 'No sessions nearby', 'inactive'); return; }
        const result = await api('/student/geo-checkin', 'POST', { latitude, longitude });
        if (result.checkedIn?.length > 0) {
            updateCheckInStatus('✅ Checked In!', `Marked in ${result.checkedIn.length} class(es)`, 'active');
            await loadStudent();
            playSuccessSound();
        } else {
            const minDist = Math.min(...sessions.map(s => Math.round(calculateDistance(latitude, longitude, s.classInfo.latitude, s.classInfo.longitude))));
            updateCheckInStatus('📍 Nearby', `${minDist}m away`, 'inactive');
        }
    } catch (error) {
        console.error(error);
    }
}

function updateCheckInStatus(title, message, status) {
    const card = document.getElementById('auto-checkin-card');
    if (!card) return;
    const icon = status === 'active' ? '✅' : '📍';
    card.className = `auto-checkin-status ${status}`;
    card.innerHTML = `<div class="status-icon">${icon}</div><h3>${title}</h3><p>${message}</p>`;
}

function playSuccessSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)(), osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination); osc.frequency.value = 800; osc.type = 'sine';
        gain.gain.setValueAtTime(0.3, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.5);
    } catch (e) { }
}

// TEACHER FUNCTIONS
async function loadTeacher() {
    const dash = document.getElementById('teacher-dashboard');
    dash.classList.add('active');
    dash.innerHTML = `<header><div><h1><i class="fas fa-chalkboard-teacher"></i> Teacher Dashboard</h1></div><button onclick="logout()"><i class="fas fa-sign-out-alt"></i> Logout</button></header><div class="content"><div class="card"><h2><i class="fas fa-clipboard-check"></i> Take Attendance</h2><div class="step-indicator"><div class="step active" id="step1">1. Program</div><div class="step" id="step2">2. Department</div><div class="step" id="step3">3. Semester</div><div class="step" id="step4">4. Subject</div><div class="step" id="step5">5. Class</div><div class="step" id="step6">6. Mode</div></div><div id="teacher-content"><h3>Select Program</h3><div class="selection-grid"><div class="selection-card" onclick="selectProgram('UG')"><h3><i class="fas fa-graduation-cap"></i></h3><h3>UG</h3></div><div class="selection-card" onclick="selectProgram('PG')"><h3><i class="fas fa-user-graduate"></i></h3><h3>PG</h3></div></div></div></div></div>`;
}

async function selectProgram(type) {
    selectedProgram = type;
    loading(true);
    try {
        const depts = await api('/teacher/departments?type=' + type);
        if (!depts.length) { document.getElementById('teacher-content').innerHTML = '<div class="alert alert-warning">No departments</div>'; loading(false); return; }
        document.getElementById('step1').classList.add('completed');
        document.getElementById('step2').classList.add('active');
        document.getElementById('teacher-content').innerHTML = `<button class="btn btn-secondary" onclick="loadTeacher()">← Back</button><h3>Select Department</h3><div class="selection-grid">${depts.map(d => `<div class="selection-card" onclick="selectDepartment(${d.id},'${d.name}')"><h3>${d.name}</h3></div>`).join('')}</div>`;
    } catch (error) {
        alert('Error: ' + error.message);
    } finally {
        loading(false);
    }
}

async function selectDepartment(id) {
    selectedDepartment = id;
    loading(true);
    try {
        const semesters = await api('/teacher/semesters?deptId=' + id);
        document.getElementById('step2').classList.add('completed');
        document.getElementById('step3').classList.add('active');
        if (!semesters.length) { document.getElementById('teacher-content').innerHTML = `<button class="btn btn-secondary" onclick="selectProgram('${selectedProgram}')">← Back</button><div class="alert alert-warning">No semesters</div>`; loading(false); return; }
        document.getElementById('teacher-content').innerHTML = `<button class="btn btn-secondary" onclick="selectProgram('${selectedProgram}')">← Back</button><h3>Select Semester</h3><div class="selection-grid">${semesters.map(s => `<div class="selection-card" onclick="selectSemester(${s.semester})"><h3>Semester ${s.semester}</h3></div>`).join('')}</div>`;
    } catch (error) {
        alert('Error: ' + error.message);
    } finally {
        loading(false);
    }
}

async function selectSemester(semester) {
    selectedSemester = semester;
    loading(true);
    try {
        const subjects = await api('/teacher/subjects?deptId=' + selectedDepartment + '&semester=' + semester);
        if (!subjects.length) { document.getElementById('teacher-content').innerHTML = '<div class="alert alert-warning">No subjects</div>'; loading(false); return; }
        document.getElementById('step3').classList.add('completed');
        document.getElementById('step4').classList.add('active');
        document.getElementById('teacher-content').innerHTML = `<button class="btn btn-secondary" onclick="selectDepartment(${selectedDepartment})">← Back</button><h3>Select Subject</h3><div class="selection-grid">${subjects.map(s => `<div class="selection-card" onclick="selectSubject(${s.id},'${s.name}')"><h3>${s.name}</h3><p>${s.code}</p></div>`).join('')}</div>`;
    } catch (error) {
        alert('Error: ' + error.message);
    } finally {
        loading(false);
    }
}

async function selectSubject(id) {
    selectedSubject = id;
    loading(true);
    try {
        const classes = await api('/teacher/classes');
        if (!classes.length) { document.getElementById('teacher-content').innerHTML = '<div class="alert alert-warning">No classes</div>'; loading(false); return; }
        document.getElementById('step4').classList.add('completed');
        document.getElementById('step5').classList.add('active');
        document.getElementById('teacher-content').innerHTML = `<button class="btn btn-secondary" onclick="selectSemester(${selectedSemester})">← Back</button><h3>Select Class</h3><div class="selection-grid">${classes.map(c => `<div class="selection-card" onclick="selectClass(${c.id},'${c.name}')"><h3>${c.name}</h3><p>${c.building}</p></div>`).join('')}</div>`;
    } catch (error) {
        alert('Error: ' + error.message);
    } finally {
        loading(false);
    }
}

function selectClass(id) {
    selectedClass = id;
    document.getElementById('step5').classList.add('completed');
    document.getElementById('step6').classList.add('active');
    document.getElementById('teacher-content').innerHTML = `<button class="btn btn-secondary" onclick="selectSubject(${selectedSubject})">← Back</button><h3>Choose Mode</h3><div class="selection-grid"><div class="mode-card" onclick="selectMode('geo')"><i class="fas fa-map-marker-alt"></i><h3>📍 Geo-Fenced</h3><p>Auto check-in</p></div><div class="mode-card" onclick="selectMode('manual')"><i class="fas fa-hand-pointer"></i><h3>✍️ Manual</h3><p>Mark manually</p></div></div>`;
}

async function selectMode(mode) {
    mode === 'geo' ? await startGeoSession() : await loadManualMode();
}

async function startGeoSession() {
    loading(true);
    try {
        const result = await api('/teacher/geo-session/start', 'POST', { subjectId: selectedSubject, classId: selectedClass, departmentId: selectedDepartment, semester: selectedSemester });
        currentSessionId = result.sessionId;
        await displayGeoSession();
        sessionInterval = setInterval(refreshSession, 3000);
    } catch (error) {
        alert('Error: ' + error.message);
    } finally {
        loading(false);
    }
}

async function displayGeoSession() {
    try {
        const { session } = await api('/teacher/geo-session/' + currentSessionId);
        document.getElementById('teacher-content').innerHTML = `<div class="live-session"><h3><span class="live-badge">🔴 LIVE</span> ${session.classInfo.name}</h3><div class="stats-bar"><div class="stat-box"><div class="number">${session.stats.present}</div><div>✅ Present</div></div><div class="stat-box"><div class="number">${session.stats.absent}</div><div>❌ Absent</div></div><div class="stat-box"><div class="number">${session.stats.unmarked}</div><div>⏳ Waiting</div></div></div><button class="btn btn-danger" onclick="endGeoSession()" style="width:100%"><i class="fas fa-stop-circle"></i> End & Save</button></div><input type="text" class="search-box" placeholder="🔍 Search..." onkeyup="filterStudents(this.value)"><div>${session.students.map(s => `<div class="student-item ${s.status}" data-name="${s.name.toLowerCase()}" data-roll="${(s.roll_number || '').toLowerCase()}"><div><div class="student-name">${s.name}</div><div class="student-roll">${s.roll_number || 'No Roll'}</div></div><div class="student-status">${s.status === 'present' ? '<span class="status-badge present">✅ Present</span>' : s.status === 'absent' ? '<span class="status-badge absent">❌ Absent</span>' : '<span class="status-badge unmarked">⏳ Waiting</span>'}<button class="btn btn-success" onclick="markManual(${s.id},'present')" ${s.status === 'present' ? 'disabled' : ''}>Present</button><button class="btn btn-danger" onclick="markManual(${s.id},'absent')" ${s.status === 'absent' ? 'disabled' : ''}>Absent</button></div></div>`).join('')}</div>`;
    } catch (error) {
        console.error(error);
    }
}

async function refreshSession() {
    if (currentSessionId) await displayGeoSession();
}

async function markManual(studentId, status) {
    try {
        await api('/teacher/geo-session/mark-manual', 'POST', { sessionId: currentSessionId, studentId, status });
        await displayGeoSession();
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

async function endGeoSession() {
    if (!confirm('End session and save?')) return;
    if (sessionInterval) { clearInterval(sessionInterval); sessionInterval = null; }
    loading(true);
    try {
        await api('/teacher/geo-session/end', 'POST', { sessionId: currentSessionId });
        alert('✅ Saved!');
        currentSessionId = null;
        await loadTeacher();
    } catch (error) {
        alert('Error: ' + error.message);
    } finally {
        loading(false);
    }
}

async function loadManualMode() {
    loading(true);
    try {
        const students = await api('/teacher/students?deptId=' + selectedDepartment + '&semester=' + selectedSemester);
        if (!students.length) { document.getElementById('teacher-content').innerHTML = '<div class="alert alert-warning">No students</div>'; loading(false); return; }
        let attendance = {};
        students.forEach(s => attendance[s.id] = true);
        document.getElementById('teacher-content').innerHTML = `<button class="btn btn-secondary" onclick="selectClass(${selectedClass})">← Back</button><h3>Manual Mode</h3><input type="text" class="search-box" placeholder="🔍 Search..." onkeyup="filterStudents(this.value)"><div>${students.map(s => `<div class="student-item" data-name="${s.name.toLowerCase()}" data-roll="${(s.roll_number || '').toLowerCase()}"><div><div class="student-name">${s.name}</div><div class="student-roll">${s.roll_number || 'No Roll'}</div></div><button class="btn btn-success" onclick="toggleManual(${s.id},this)">✅ Present</button></div>`).join('')}</div><button class="btn btn-success" style="width:100%;padding:16px;margin-top:20px;" onclick="submitManual()"><i class="fas fa-check-circle"></i> Submit</button>`;
        window.manualAttendance = attendance;
    } catch (error) {
        alert('Error: ' + error.message);
    } finally {
        loading(false);
    }
}

function toggleManual(studentId, button) {
    window.manualAttendance[studentId] = !window.manualAttendance[studentId];
    button.className = window.manualAttendance[studentId] ? 'btn btn-success' : 'btn btn-danger';
    button.innerHTML = window.manualAttendance[studentId] ? '✅ Present' : '❌ Absent';
}

async function submitManual() {
    if (!confirm('Submit attendance?')) return;
    loading(true);
    try {
        const records = Object.keys(window.manualAttendance).map(studentId => ({ studentId: parseInt(studentId), isPresent: window.manualAttendance[studentId] }));
        await api('/teacher/attendance/submit', 'POST', { subjectId: selectedSubject, classId: selectedClass, attendance: records });
        alert('✅ Submitted!');
        await loadTeacher();
    } catch (error) {
        alert('Error: ' + error.message);
    } finally {
        loading(false);
    }
}