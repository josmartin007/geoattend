const API_CONFIG = {
    BASE_URL: 'http://localhost:3000/api',
    ENDPOINTS: {
        LOGIN: '/auth/login',
        LOGOUT: '/auth/logout',
        GET_DASHBOARD_STATS: '/admin/dashboard/stats',
        GET_USERS: '/admin/users',
        GET_ATTENDANCE_LOGS: '/admin/attendance/logs',
        GET_STUDENT_DASHBOARD: '/student/dashboard',
        GET_SCHEDULE: '/student/schedule',
        GET_ATTENDANCE_HISTORY: '/student/attendance/history',
        MARK_ATTENDANCE: '/student/attendance/mark',
        GET_ATTENDANCE_REPORT: '/student/attendance/report',
        GET_TEACHER_DASHBOARD: '/teacher/dashboard',
        GET_TIMETABLE: '/teacher/timetable',
        GET_TEACHER_COURSES: '/teacher/courses',
        GET_STUDENTS: '/teacher/students/:courseId',
        SUBMIT_ATTENDANCE: '/teacher/attendance/submit',
        START_GEO_SESSION: '/teacher/attendance/geo-session',
        GET_GEO_RESULTS: '/teacher/attendance/geo-results/:sessionId'
    }
};