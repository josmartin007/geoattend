// ================== STUDENT ATTENDANCE HISTORY FUNCTIONS ==================

// Add Attendance History Section to Student Dashboard
async function addStudentHistorySection() {
    const dash = document.getElementById('student-dashboard');
    
    // Check if history section already exists
    if (document.getElementById('student-history-card')) {
        return;
    }
    
    const historyHTML = `
        <div class="card" id="student-history-card">
            <h2><i class="fas fa-history"></i> Attendance History</h2>
            
            <!-- Date Filter -->
            <div class="filter-date-section">
                <div class="filter-date-header">
                    <i class="fas fa-filter"></i> Filter by Date Range
                </div>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; align-items: end;">
                    <div>
                        <label style="display: block; margin-bottom: 5px; font-weight: 600; font-size: 14px; color: #495057;">
                            <i class="fas fa-calendar-alt"></i> Start Date
                        </label>
                        <input type="date" id="student-start-date" style="width: 100%; padding: 10px; border: 2px solid #ddd; border-radius: 6px; font-size: 14px;">
                    </div>
                    <div>
                        <label style="display: block; margin-bottom: 5px; font-weight: 600; font-size: 14px; color: #495057;">
                            <i class="fas fa-calendar-check"></i> End Date
                        </label>
                        <input type="date" id="student-end-date" style="width: 100%; padding: 10px; border: 2px solid #ddd; border-radius: 6px; font-size: 14px;">
                    </div>
                    <div style="display: flex; gap: 10px;">
                        <button class="btn" onclick="filterStudentHistory()" style="flex: 1;">
                            <i class="fas fa-search"></i> Filter
                        </button>
                        <button class="btn btn-secondary" onclick="clearStudentHistoryFilter()">
                            <i class="fas fa-redo"></i> Reset
                        </button>
                    </div>
                </div>
            </div>
            
            <!-- History Table Container -->
            <div id="student-history-container">
                <div style="text-align: center; padding: 40px; color: #999;">
                    <i class="fas fa-calendar-alt" style="font-size: 48px; margin-bottom: 15px; opacity: 0.5;"></i>
                    <p style="font-size: 16px;">Select date range and click Filter to view your attendance history</p>
                </div>
            </div>
        </div>
    `;
    
    // Append to content div
    const content = dash.querySelector('.content');
    if (content) {
        content.insertAdjacentHTML('beforeend', historyHTML);
    }
    
    // Set default dates (last 30 days)
    const today = new Date();
    const thirtyDaysAgo = new Date(today.getTime() - (30 * 24 * 60 * 60 * 1000));
    document.getElementById('student-end-date').value = today.toISOString().split('T')[0];
    document.getElementById('student-start-date').value = thirtyDaysAgo.toISOString().split('T')[0];
    
    // Load initial history
    await filterStudentHistory();
}

// Filter Student Attendance History
async function filterStudentHistory() {
    const startDate = document.getElementById('student-start-date').value;
    const endDate = document.getElementById('student-end-date').value;
    
    if (!startDate || !endDate) {
        alert('⚠️ Please select both start and end dates');
        return;
    }
    
    if (new Date(startDate) > new Date(endDate)) {
        alert('⚠️ Start date cannot be after end date');
        return;
    }
    
    loading(true);
    try {
        const history = await api(`/student/attendance/history?startDate=${startDate}&endDate=${endDate}`);
        
        const container = document.getElementById('student-history-container');
        
        if (!history || history.length === 0) {
            container.innerHTML = `
                <div class="alert alert-warning" style="margin-top: 20px;">
                    <i class="fas fa-info-circle"></i> No attendance records found for the selected date range.
                </div>
            `;
            return;
        }
        
        const presentCount = history.filter(r => r.status === 'present').length;
        const absentCount = history.filter(r => r.status === 'absent').length;
        const attendancePercentage = Math.round((presentCount / history.length) * 100);
        
        container.innerHTML = `
            <div class="history-table-wrapper">
                <table class="history-table">
                    <thead>
                        <tr>
                            <th><i class="fas fa-calendar"></i> Date</th>
                            <th><i class="fas fa-book"></i> Subject</th>
                            <th><i class="fas fa-chalkboard-teacher"></i> Teacher</th>
                            <th><i class="fas fa-clock"></i> Time</th>
                            <th><i class="fas fa-check-circle"></i> Status</th>
                            <th><i class="fas fa-map-marker-alt"></i> Location</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${history.map(record => {
                            const statusClass = record.status === 'present' ? 'present' : 'absent';
                            const statusIcon = record.status === 'present' ? '✅' : '❌';
                            const statusText = record.status === 'present' ? 'Present' : 'Absent';
                            const date = new Date(record.marked_at);
                            
                            return `
                                <tr>
                                    <td class="history-date-cell">
                                        ${date.toLocaleDateString('en-US', { 
                                            month: 'short', 
                                            day: 'numeric', 
                                            year: 'numeric' 
                                        })}
                                    </td>
                                    <td class="history-subject-cell">
                                        <strong>${record.subject_name}</strong>
                                        <small>${record.subject_code}</small>
                                    </td>
                                    <td>${record.teacher_name || 'N/A'}</td>
                                    <td class="history-time-cell">
                                        ${date.toLocaleTimeString('en-US', { 
                                            hour: '2-digit', 
                                            minute: '2-digit',
                                            hour12: true
                                        })}
                                    </td>
                                    <td>
                                        <span class="status-badge ${statusClass}">
                                            ${statusIcon} ${statusText}
                                        </span>
                                    </td>
                                    <td>${record.class_name || 'N/A'}${record.building ? ` - ${record.building}` : ''}</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
            
            <div class="history-stats-bar">
                <div class="stats-left">
                    <div class="history-stat-item total">
                        <i class="fas fa-list"></i>
                        <span>Total: <span class="history-stat-value">${history.length}</span></span>
                    </div>
                    <div class="history-stat-item present">
                        <i class="fas fa-check-circle"></i>
                        <span>Present: <span class="history-stat-value">${presentCount}</span></span>
                    </div>
                    <div class="history-stat-item absent">
                        <i class="fas fa-times-circle"></i>
                        <span>Absent: <span class="history-stat-value">${absentCount}</span></span>
                    </div>
                    <div class="history-stat-item total">
                        <i class="fas fa-percentage"></i>
                        <span>Attendance: <span class="history-stat-value">${attendancePercentage}%</span></span>
                    </div>
                </div>
                <button class="btn btn-success" onclick="exportStudentHistory()">
                    <i class="fas fa-file-excel"></i> Export to Excel
                </button>
            </div>
        `;
        
        // Store for export
        window.studentHistoryData = history;
        
    } catch (error) {
        document.getElementById('student-history-container').innerHTML = `
            <div class="alert alert-danger" style="margin-top: 20px;">
                <i class="fas fa-exclamation-circle"></i> Error loading history: ${error.message}
            </div>
        `;
    } finally {
        loading(false);
    }
}

// Clear Student History Filter
function clearStudentHistoryFilter() {
    const today = new Date();
    const thirtyDaysAgo = new Date(today.getTime() - (30 * 24 * 60 * 60 * 1000));
    document.getElementById('student-end-date').value = today.toISOString().split('T')[0];
    document.getElementById('student-start-date').value = thirtyDaysAgo.toISOString().split('T')[0];
    filterStudentHistory();
}

// Export Student History to Excel
function exportStudentHistory() {
    // Check if XLSX library is loaded
    if (typeof XLSX === 'undefined') {
        alert('❌ Excel export library not loaded. Please refresh the page and try again.');
        return;
    }
    
    if (!window.studentHistoryData || window.studentHistoryData.length === 0) {
        alert('⚠️ No data to export');
        return;
    }
    
    try {
        // Prepare data for export
        const exportData = window.studentHistoryData.map(record => {
            const date = new Date(record.marked_at);
            return {
                'Date': date.toLocaleDateString('en-US', { 
                    month: 'short', 
                    day: 'numeric', 
                    year: 'numeric' 
                }),
                'Day': date.toLocaleDateString('en-US', { weekday: 'long' }),
                'Time': date.toLocaleTimeString('en-US', { 
                    hour: '2-digit', 
                    minute: '2-digit',
                    hour12: true
                }),
                'Subject Name': record.subject_name,
                'Subject Code': record.subject_code,
                'Teacher': record.teacher_name || 'N/A',
                'Status': record.status.toUpperCase(),
                'Location': record.class_name || 'N/A',
                'Building': record.building || 'N/A'
            };
        });
        
        // Create worksheet
        const ws = XLSX.utils.json_to_sheet(exportData);
        
        // Set column widths
        const colWidths = [
            { wch: 15 }, // Date
            { wch: 12 }, // Day
            { wch: 10 }, // Time
            { wch: 30 }, // Subject Name
            { wch: 15 }, // Subject Code
            { wch: 25 }, // Teacher
            { wch: 10 }, // Status
            { wch: 20 }, // Location
            { wch: 15 }  // Building
        ];
        ws['!cols'] = colWidths;
        
        // Create workbook
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Attendance History");
        
        // Generate filename
        const studentName = currentUser.name.replace(/[^a-zA-Z0-9]/g, '_');
        const startDate = document.getElementById('student-start-date').value;
        const endDate = document.getElementById('student-end-date').value;
        const filename = `${studentName}_Attendance_${startDate}_to_${endDate}.xlsx`;
        
        // Download file
        XLSX.writeFile(wb, filename);
        
        // Show success message
        setTimeout(() => {
            alert(`✅ Attendance history exported successfully!\n\nFile: ${filename}\nRecords: ${exportData.length}`);
        }, 100);
        
    } catch (error) {
        console.error('Export error:', error);
        alert('❌ Error exporting data: ' + error.message);
    }
}