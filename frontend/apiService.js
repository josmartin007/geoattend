class APIService {
    constructor() {
        this.baseURL = API_CONFIG.BASE_URL;
        this.token = localStorage.getItem('auth_token');
    }

    setToken(token) {
        this.token = token;
        localStorage.setItem('auth_token', token);
    }

    clearToken() {
        this.token = null;
        localStorage.removeItem('auth_token');
    }

    async request(endpoint, options = {}) {
        const url = `${this.baseURL}${endpoint}`;
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };

        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }

        try {
            const response = await fetch(url, {
                ...options,
                headers
            });

            if (!response.ok) {
                if (response.status === 401) {
                    this.clearToken();
                    window.location.href = '/';
                    throw new Error('Unauthorized');
                }
                const error = await response.json();
                throw new Error(error.message || 'Request failed');
            }

            return await response.json();
        } catch (error) {
            console.error('API Error:', error);
            throw error;
        }
    }

    async get(endpoint) {
        return this.request(endpoint, { method: 'GET' });
    }

    async post(endpoint, data) {
        return this.request(endpoint, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    async put(endpoint, data) {
        return this.request(endpoint, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }

    async delete(endpoint) {
        return this.request(endpoint, { method: 'DELETE' });
    }

    async login(username, password, role) {
        const response = await this.post(API_CONFIG.ENDPOINTS.LOGIN, {
            username,
            password,
            role
        });
        if (response.token) {
            this.setToken(response.token);
        }
        return response;
    }

    async logout() {
        await this.post(API_CONFIG.ENDPOINTS.LOGOUT, {});
        this.clearToken();
    }

    async getAdminDashboardStats() {
        return this.get(API_CONFIG.ENDPOINTS.GET_DASHBOARD_STATS);
    }

    async getUsers() {
        return this.get(API_CONFIG.ENDPOINTS.GET_USERS);
    }

    async getAttendanceLogs() {
        return this.get(API_CONFIG.ENDPOINTS.GET_ATTENDANCE_LOGS);
    }

    async getStudentDashboard() {
        return this.get(API_CONFIG.ENDPOINTS.GET_STUDENT_DASHBOARD);
    }

    async getStudentSchedule(date) {
        return this.get(`${API_CONFIG.ENDPOINTS.GET_SCHEDULE}?date=${date}`);
    }

    async getAttendanceHistory(limit = 10) {
        return this.get(`${API_CONFIG.ENDPOINTS.GET_ATTENDANCE_HISTORY}?limit=${limit}`);
    }

    async markAttendance(classId, location) {
        return this.post(API_CONFIG.ENDPOINTS.MARK_ATTENDANCE, {
            classId,
            latitude: location.latitude,
            longitude: location.longitude,
            timestamp: new Date().toISOString()
        });
    }

    async getAttendanceReport(filters) {
        const query = new URLSearchParams(filters).toString();
        return this.get(`${API_CONFIG.ENDPOINTS.GET_ATTENDANCE_REPORT}?${query}`);
    }

    async getTeacherDashboard() {
        return this.get(API_CONFIG.ENDPOINTS.GET_TEACHER_DASHBOARD);
    }

    async getTeacherCourses() {
        return this.get(API_CONFIG.ENDPOINTS.GET_TEACHER_COURSES);
    }

    async getCourseStudents(courseId) {
        const endpoint = API_CONFIG.ENDPOINTS.GET_STUDENTS.replace(':courseId', courseId);
        return this.get(endpoint);
    }

    async submitTeacherAttendance(attendanceData) {
        return this.post(API_CONFIG.ENDPOINTS.SUBMIT_ATTENDANCE, attendanceData);
    }

    async startGeoSession(sessionData) {
        return this.post(API_CONFIG.ENDPOINTS.START_GEO_SESSION, sessionData);
    }

    async getGeoResults(sessionId) {
        const endpoint = API_CONFIG.ENDPOINTS.GET_GEO_RESULTS.replace(':sessionId', sessionId);
        return this.get(endpoint);
    }
}

const apiService = new APIService();