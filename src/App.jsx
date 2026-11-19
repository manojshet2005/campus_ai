
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Bell,
  Building2,
  CheckCircle2,
  FileText,
  GraduationCap,
  LayoutDashboard,
  MessageSquareText,
  PlusCircle,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UserCircle2,
  Users,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { CATEGORY_DATA, DEFAULT_DEPARTMENTS } from './data/seedData.js'
import { api, normalizeComplaint } from './services/apiClient.js'
import { buildIssueGroups, computeAnalytics, normalizeStudentKey } from './utils/analytics.js'

const ADMIN_ROLES = ['superAdmin', 'managementViewer', 'departmentAdmin', 'safeguardingOfficer']
const CHART_COLORS = ['#1d4ed8', '#0f766e', '#f59e0b', '#ec4899', '#8b5cf6', '#10b981', '#ef4444', '#e2e8f0']
const STATUS_TONES = {
  Submitted: 'submitted',
  'AI Processing': 'processing',
  'Pending Review': 'pending',
  Assigned: 'assigned',
  'Under Investigation': 'investigating',
  'In Progress': 'progress',
  Resolved: 'resolved',
  Reopened: 'reopened',
  Closed: 'closed',
}

function formatDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function hasAdminAccess(role) {
  return ADMIN_ROLES.includes(role)
}

function getReportRequest(periodType, range) {
  if (periodType !== 'custom') return { periodType }
  if (!range.startDate || !range.endDate) return null
  return { periodType, startAt: range.startDate, endAt: range.endDate }
}

function cardClass(color = 'blue') {
  const map = {
    blue: 'navy-card',
    green: 'success-card',
    amber: 'warning-card',
    pink: 'pink-card',
    slate: 'soft-card',
  }
  return map[color] ?? 'soft-card'
}

function App() {
  const [data, setData] = useState({ users: [], complaints: [], notifications: [], departments: DEFAULT_DEPARTMENTS, issueGroups: [], analytics: null })
  const [view, setView] = useState('landing')
  const [portal, setPortal] = useState('student')
  const [currentUser, setCurrentUser] = useState(null)
  const [dataConnected, setDataConnected] = useState(false)
  const [authMode, setAuthMode] = useState('login')
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '', studentId: '', department: '' })
  const [error, setError] = useState('')
  const [studentPage, setStudentPage] = useState('dashboard')
  const [selectedComplaintId, setSelectedComplaintId] = useState('')
  const [reportRange, setReportRange] = useState('month')
  const [customRange, setCustomRange] = useState({ startDate: '', endDate: '' })
  const [generatedReport, setGeneratedReport] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [complaintForm, setComplaintForm] = useState({
    category: CATEGORY_DATA[0].name,
    subcategory: CATEGORY_DATA[0].subcategories[0],
    customCategory: '',
    originalComplaint: '',
    isAnonymous: false,
  })

  const loadUserData = useCallback(async (role) => {
    try {
      const [complaintsResult, notificationsResult, groupsResult, analyticsResult] = await Promise.all([
        api.complaints(),
        api.notifications(),
        hasAdminAccess(role) ? api.issueGroups() : Promise.resolve({ groups: [] }),
        hasAdminAccess(role) ? api.analytics() : Promise.resolve({ analytics: null }),
      ])
      setData((previous) => ({
        ...previous,
        complaints: complaintsResult.complaints.map(normalizeComplaint),
        notifications: notificationsResult.notifications.map((item) => ({
          id: item.id,
          recipient: item.recipient_id,
          title: item.title,
          text: item.text,
          createdAt: item.created_at,
          read: Boolean(item.read_at),
        })),
        analytics: analyticsResult.analytics,
        issueGroups: (groupsResult.groups || []).map((group) => ({
          id: group.id,
          title: group.title,
          explanation: group.summary || 'Database-backed recurring issue.',
          priority: group.priority || 'MEDIUM',
          urgency: group.urgency || 'NORMAL',
          distinctStudents: group.distinct_students || 0,
          count: group.member_count || group.complaint_count || 0,
          department: group.department || 'General Administration',
          groupingMethod: 'embedding',
          firstReported: group.first_reported,
          latestReported: group.latest_reported,
          complaints: (group.complaints || []).map((complaint) => ({
            ...complaint,
            safetyFlags: complaint.safety_flags || complaint.safetyFlags || [],
          })),
        })),
      }))
      setDataConnected(true)
    } catch (loadError) {
      setDataConnected(false)
      setError(loadError.message)
    }
  }, [])

  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        const health = await api.health()
        if (!active) return
        setDataConnected(health.database === 'connected')
        const session = await api.session()
        if (!active) return
        if (!session.user) {
          setCurrentUser(null)
          setView('landing')
          return
        }
        setCurrentUser(session.user)
        setPortal(session.user.role === 'student' ? 'student' : 'admin')
        setView(session.user.role === 'student' ? 'studentPortal' : 'adminPortal')
        await loadUserData(session.user.role)
      } catch (sessionError) {
        if (active) {
          setDataConnected(false)
          setError(sessionError.message)
        }
      }
    }
    refresh()
    return () => { active = false }
  }, [loadUserData])

  useEffect(() => {
    if (!currentUser) return undefined
    const interval = window.setInterval(() => {
      loadUserData(currentUser.role)
    }, 15000)
    return () => window.clearInterval(interval)
  }, [currentUser, loadUserData])

  const issueGroups = useMemo(
    () => data.issueGroups?.length ? data.issueGroups : buildIssueGroups(data.complaints),
    [data.complaints, data.issueGroups],
  )
  const analytics = useMemo(() => data.analytics || computeAnalytics(data.complaints), [data.analytics, data.complaints])
  const reportRequest = getReportRequest(reportRange, customRange)
  const reportRequestKey = JSON.stringify(reportRequest)
  const reportSummary = generatedReport?.requestKey === reportRequestKey ? generatedReport.report : null

  useEffect(() => {
    if (!currentUser || !hasAdminAccess(currentUser.role) || studentPage !== 'reports') {
      return undefined
    }
    const request = getReportRequest(reportRange, customRange)
    if (!request) return undefined
    let active = true
    api.createReport(request)
      .then(({ report }) => {
        if (active) setGeneratedReport({ requestKey: JSON.stringify(request), report })
      })
      .catch((reportError) => {
        if (active) setError(`Could not load report data: ${reportError.message}`)
      })
    return () => { active = false }
  }, [currentUser, studentPage, reportRange, customRange])

  const filteredComplaints = useMemo(() => (
    data.complaints.filter((complaint) => {
      const matchesSearch = searchTerm.length === 0 || [complaint.id, complaint.category, complaint.subcategory, complaint.summary, complaint.originalComplaint].join(' ').toLowerCase().includes(searchTerm.toLowerCase())
      const matchesStatus = statusFilter === 'All' || complaint.status === statusFilter
      return matchesSearch && matchesStatus
    })
  ), [data.complaints, searchTerm, statusFilter])

  const myComplaints = useMemo(() => {
    if (!currentUser) return []
    const currentStudentKey = normalizeStudentKey(currentUser.uid, currentUser.name)
    return [...data.complaints]
      .filter((complaint) => normalizeStudentKey(complaint.studentId, complaint.studentName) === currentStudentKey || complaint.studentName === currentUser.name)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  }, [currentUser, data.complaints])

  const selectedComplaint = useMemo(
    () => data.complaints.find((complaint) => complaint.id === selectedComplaintId) ?? myComplaints[0] ?? data.complaints[0],
    [data.complaints, myComplaints, selectedComplaintId],
  )

  const visibleNotifications = useMemo(() => {
    if (!currentUser) return []
    return data.notifications.filter((notification) => notification.recipient === currentUser.uid || notification.recipient === currentUser.email || notification.recipient === 'system')
  }, [currentUser, data.notifications])

  const handleAuthSubmit = async (event) => {
    event.preventDefault()
    const email = authForm.email.trim().toLowerCase()
    const password = authForm.password

    if (!email || !password) {
      setError('Please provide your email and password.')
      return
    }

    try {
      if (authMode === 'register') {
      if (!authForm.name || !authForm.studentId) {
        setError('Please provide your full name and student ID.')
        return
      }
        const result = await api.register({
          name: authForm.name,
          email,
          password,
          studentId: authForm.studentId,
          department: authForm.department || 'General Administration',
        })
        if (result.confirmationRequired) {
          setAuthMode('login')
          setError(result.message || 'Check your email to confirm your account, then sign in.')
          return
        }
        setCurrentUser(result.user)
        setView('studentPortal')
        setStudentPage('dashboard')
        await loadUserData(result.user.role)
      } else {
        const result = await api.login({ email, password })
        if (portal === 'student' && result.user.role !== 'student') {
          setError('This account is not a student account.')
          await api.logout()
          return
        }
        if (portal === 'admin' && !hasAdminAccess(result.user.role)) {
          setError('This account is not authorised for the management portal.')
          await api.logout()
          return
        }
        setCurrentUser(result.user)
        setView(portal === 'student' ? 'studentPortal' : 'adminPortal')
        await loadUserData(result.user.role)
      }
      setError('')
    } catch (authError) {
      setError(authError.message)
    }
  }

  const handleComplaintSubmit = async () => {
    const complaintText = complaintForm.originalComplaint.trim()
    if (!complaintText) {
      setError('Please enter a complaint before submitting.')
      return
    }

    let newComplaint
    try {
      const result = await api.submitComplaint({
        originalComplaint: complaintText,
        category: complaintForm.category,
        subcategory: complaintForm.subcategory,
        customCategory: complaintForm.customCategory,
        isAnonymous: complaintForm.isAnonymous,
      })
      newComplaint = normalizeComplaint(result.complaint)
    } catch (analysisError) {
      setError(`Live complaint submission failed: ${analysisError.message}`)
      return
    }

    setData((prev) => ({
      ...prev,
      complaints: [newComplaint, ...prev.complaints],
    }))

    setComplaintForm({
      category: CATEGORY_DATA[0].name,
      subcategory: CATEGORY_DATA[0].subcategories[0],
      customCategory: '',
      originalComplaint: '',
      isAnonymous: false,
    })
    setStudentPage('complaints')
    setSelectedComplaintId(newComplaint.id)
    setError('')
  }

  const handleFeedback = async (complaintId, rating) => {
    try {
      await api.feedback(complaintId, { rating, comment: 'Feedback recorded.' })
      await loadUserData(currentUser.role)
    } catch (feedbackError) {
      setError(feedbackError.message)
    }
  }

  const handleComplaintUpdate = async (complaintId, status) => {
    try {
      await api.updateComplaint(complaintId, {
        status,
        officialResponse: status === 'Resolved' ? 'The complaint has been resolved after review.' : '',
        note: `Status changed to ${status}.`,
      })
      await loadUserData(currentUser.role)
    } catch (updateError) {
      setError(updateError.message)
    }
  }

  const handleLogout = async () => {
    await api.logout().catch(() => {})

    setCurrentUser(null)
    setView('landing')
    setPortal('student')
    setAuthMode('login')
    setError('')
  }

  const selectedCategoryDetails = CATEGORY_DATA.find((category) => category.name === complaintForm.category) ?? CATEGORY_DATA[0]

  const reportCards = [
    { label: 'Total complaints', value: analytics.total, icon: MessageSquareText, tone: 'blue' },
    { label: 'Unique students', value: analytics.uniqueStudents, icon: Users, tone: 'green' },
    { label: 'Critical issues', value: analytics.byPriority.CRITICAL, icon: ShieldAlert, tone: 'pink' },
    { label: 'High priority', value: analytics.byPriority.HIGH, icon: AlertTriangle, tone: 'amber' },
    { label: 'Resolution rate', value: `${Math.round(analytics.resolutionRate)}%`, icon: CheckCircle2, tone: 'green' },
    { label: 'Pending review', value: analytics.byStatus['Pending Review'] + analytics.byStatus['AI Processing'], icon: Bell, tone: 'slate' },
  ]

  const categoryChartData = analytics.categoryStats.map((entry) => ({
    name: entry.name,
    value: entry.count,
  }))

  const priorityChartData = Object.entries(analytics.byPriority).map(([name, value]) => ({ name, value }))
  const reportDepartmentChartData = (reportSummary?.deptStats || []).map((entry) => ({ name: entry.name, value: entry.count }))
  const weeklyTrendData = data.analytics?.weeklyTrend || []
  const trendingIssue = [...issueGroups].sort((a, b) => b.count - a.count)[0]
  const safetyComplaintCount = data.analytics?.safetyRestricted
    ?? data.complaints.filter((complaint) => complaint.isSafetyRestricted).length

  const fetchCurrentReport = async () => {
    const request = getReportRequest(reportRange, customRange)
    if (!request) throw new Error('Choose both dates for the custom report period.')
    const result = await api.createReport(request)
    setGeneratedReport({ requestKey: JSON.stringify(request), report: result.report })
    return result.report
  }

  const exportCsvReport = async () => {
    let report
    try {
      report = await fetchCurrentReport()
    } catch (exportError) {
      setError(`Could not export report: ${exportError.message}`)
      return
    }
    const csvRows = [
      ['Metric', 'Value'],
      ['Period', `${report.startAt} to ${report.endAt}`],
      ['Total complaints', String(report.total)],
      ['Unique students', String(report.distinctStudents)],
      ['Resolution rate', `${Math.round(report.resolutionRate)}%`],
      ['Critical issues', String(report.byPriority.CRITICAL)],
      ['High priority', String(report.byPriority.HIGH)],
      ['Issue groups', String(report.issueGroupCount)],
      ...Object.entries(report.byPriority).map(([priority, count]) => [`Priority: ${priority}`, String(count)]),
      ...Object.entries(report.byStatus).map(([status, count]) => [`Status: ${status}`, String(count)]),
      ...report.categoryStats.map((entry) => [`Category: ${entry.name}`, String(entry.count)]),
      ...report.deptStats.map((entry) => [`Department: ${entry.name}`, String(entry.count)]),
    ]

    const csv = csvRows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = 'campusvoice-report.csv'
    link.click()
    URL.revokeObjectURL(link.href)
  }

  const exportPdfReport = async () => {
    let report
    try {
      report = await fetchCurrentReport()
    } catch (exportError) {
      setError(`Could not export report: ${exportError.message}`)
      return
    }
    const lines = [
      'CampusVoice AI report',
      `Generated: ${new Date().toISOString()}`,
      `Period: ${report.startAt} to ${report.endAt}`,
      `Total complaints: ${report.total}`,
      `Unique students: ${report.distinctStudents}`,
      `Resolution rate: ${Math.round(report.resolutionRate)}%`,
      `Critical issues: ${report.byPriority.CRITICAL}`,
      `High priority: ${report.byPriority.HIGH}`,
      `Issue groups: ${report.issueGroupCount}`,
      ...Object.entries(report.byStatus).map(([status, count]) => `Status ${status}: ${count}`),
      ...report.categoryStats.map((entry) => `Category ${entry.name}: ${entry.count} complaints`),
      ...report.deptStats.map((entry) => `Department ${entry.name}: ${entry.count} complaints`),
      ...(report.aiSummary?.summary ? [`AI summary: ${report.aiSummary.summary}`] : []),
      ...(report.aiSummary?.recommendations || []).map((item) => `Recommendation: ${item}`),
    ]

    const escapePdfText = (value) => String(value)
      .replace(/[^\x20-\x7E]/g, '?')
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
    const wrappedLines = lines.flatMap((line) => {
      const words = escapePdfText(line).split(/\s+/)
      const result = []
      let current = ''
      words.forEach((word) => {
        if (current && `${current} ${word}`.length > 85) {
          result.push(current)
          current = word
        } else {
          current = current ? `${current} ${word}` : word
        }
      })
      if (current) result.push(current)
      return result
    })
    const pages = Array.from({ length: Math.ceil(wrappedLines.length / 35) || 1 }, (_, index) => (
      wrappedLines.slice(index * 35, (index + 1) * 35)
    ))
    const pageReferences = pages.map((_, index) => `${4 + index * 2} 0 R`).join(' ')
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      `<< /Type /Pages /Kids [${pageReferences}] /Count ${pages.length} >>`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ]
    pages.forEach((pageLines, index) => {
      const pageNumber = 4 + index * 2
      const contentNumber = pageNumber + 1
      const textStream = pageLines
        .map((line, lineIndex) => `BT /F1 10 Tf 50 ${760 - lineIndex * 20} Td (${line}) Tj ET`)
        .join('\n')
      objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNumber} 0 R >>`)
      objects.push(`<< /Length ${textStream.length} >>\nstream\n${textStream}\nendstream`)
    })

    let pdf = '%PDF-1.4\n'
    const offsets = [0]
    objects.forEach((objectContent, index) => {
      offsets.push(pdf.length)
      pdf += `${index + 1} 0 obj\n${objectContent}\nendobj\n`
    })

    const xrefOffset = pdf.length
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
    offsets.slice(1).forEach((offset) => {
      pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
    })

    pdf += `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xrefOffset}\n%%EOF`

    const blob = new Blob([pdf], { type: 'application/pdf;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = 'campusvoice-report.pdf'
    link.click()
    URL.revokeObjectURL(link.href)
  }

  if (view === 'landing') {
    return (
      <div className="page-shell">
        <header className="landing-header">
          <div className="brand-wrap">
            <div className="brand-mark"><GraduationCap size={22} /></div>
            <div>
              <div className="brand-name">CAMPUSVOICE AI</div>
              <div className="brand-subtext">Smart grievance intelligence</div>
            </div>
          </div>
          <div className="pill-tag">{dataConnected ? 'Supabase live data' : 'Supabase connection required'}</div>
          <button className="primary-btn small" onClick={() => { setPortal('student'); setView('studentAuth') }}>
            Student Login
          </button>
        </header>

        <main className="landing-layout">
          <section className="hero-panel">
            <div className="eyebrow-row"><Sparkles size={16} /> Intelligent campus issue platform</div>
            <h1>Your Campus. Your Voice. Your Change.</h1>
            <p className="hero-copy">
              An intelligent platform that listens to students, identifies campus problems and helps institutions act with clarity.
            </p>

            <div className="portal-grid">
              <button className="portal-card student" onClick={() => { setPortal('student'); setView('studentAuth') }}>
                <div className="portal-icon student-icon"><UserCircle2 size={24} /></div>
                <div className="portal-title">Student Portal</div>
                <p>Raise your concerns, submit complaints, track their progress and make your campus better.</p>
                <div className="portal-actions">
                  <span>Student Login</span>
                  <span>Student Registration</span>
                </div>
              </button>

              <button className="portal-card admin" onClick={() => { setPortal('admin'); setView('adminAuth') }}>
                <div className="portal-icon admin-icon"><Building2 size={24} /></div>
                <div className="portal-title">Administrator Portal</div>
                <p>Monitor campus grievances, discover recurring problems, analyse student feedback and manage resolutions.</p>
                <div className="portal-actions">
                  <span>Administrator Login</span>
                  <span>Management Login</span>
                </div>
              </button>
            </div>
          </section>

          <aside className="insight-panel">
            <div className="mini-card navy-card">
              <div className="card-label"><LayoutDashboard size={18} /> Live campus insight</div>
              <div className="big-number">{dataConnected ? analytics.total : '—'}</div>
              <div className="small-label">complaints tracked</div>
            </div>
            <div className="mini-card success-card">
              <div className="card-label"><TrendingUp size={18} /> Trending issue</div>
              <div className="mini-title">{dataConnected ? trendingIssue?.title || 'No recurring issues yet' : 'Database unavailable'}</div>
              <div className="small-label">{dataConnected
                ? trendingIssue ? `${trendingIssue.distinctStudents} distinct students affected` : 'Live issue groups appear here'
                : 'Connect Supabase to load current issue groups'}</div>
            </div>
            <div className="mini-card warning-card">
              <div className="card-label"><ShieldAlert size={18} /> Safety alert</div>
              <div className="mini-title">{!dataConnected
                ? 'Database unavailable'
                : safetyComplaintCount ? `${safetyComplaintCount} restricted case${safetyComplaintCount === 1 ? '' : 's'}` : 'No active safety cases'}</div>
              <div className="small-label">{dataConnected ? 'From current Supabase records' : 'Live data unavailable'}</div>
            </div>
          </aside>
        </main>
      </div>
    )
  }

  if (view === 'studentAuth') {
    return (
      <div className="page-shell auth-shell">
        <div className="auth-card wide">
          <div className="auth-topbar">
            <button className="ghost-btn" onClick={() => setView('landing')}>← Back</button>
            <div className="pill-tag">Student portal</div>
          </div>

          <div className="auth-heading">
            <h2>{authMode === 'login' ? 'Student login' : 'Student registration'}</h2>
            <p>Access your complaints, updates and resolution history.</p>
          </div>

          <form onSubmit={handleAuthSubmit} className="auth-form">
            {authMode === 'register' && (
              <>
                <label>Name
                  <input value={authForm.name} onChange={(event) => setAuthForm({ ...authForm, name: event.target.value })} placeholder="Your full name" />
                </label>
                <label>Student ID
                  <input value={authForm.studentId} onChange={(event) => setAuthForm({ ...authForm, studentId: event.target.value })} placeholder="CS-2041" />
                </label>
                <label>Department
                  <input value={authForm.department} onChange={(event) => setAuthForm({ ...authForm, department: event.target.value })} placeholder="Computer Science" />
                </label>
              </>
            )}

            <label>Email address
              <input type="email" value={authForm.email} onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })} placeholder="student@campusvoice.ai" />
            </label>
            <label>Password
              <input type="password" value={authForm.password} onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })} placeholder="••••••••" />
            </label>

            {error && <div className="error-box">{error}</div>}

            <button type="submit" className="primary-btn full-width">
              {authMode === 'login' ? 'Continue to dashboard' : 'Create account'}
            </button>
          </form>

          <div className="auth-footer">
            <button className="link-btn" onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}>
              {authMode === 'login' ? 'Need a new account? Register' : 'Already have an account? Login'}
            </button>
          </div>

        </div>
      </div>
    )
  }

  if (view === 'adminAuth') {
    return (
      <div className="page-shell auth-shell">
        <div className="auth-card wide">
          <div className="auth-topbar">
            <button className="ghost-btn" onClick={() => setView('landing')}>← Back</button>
            <div className="pill-tag">Management access</div>
          </div>

          <div className="auth-heading">
            <h2>Administrator login</h2>
            <p>Secure access for management, department leads and safeguarding personnel.</p>
          </div>

          <form onSubmit={handleAuthSubmit} className="auth-form">
            <label>Email address
              <input type="email" value={authForm.email} onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })} placeholder="admin@campusvoice.ai" />
            </label>
            <label>Password
              <input type="password" value={authForm.password} onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })} />
            </label>

            {error && <div className="error-box">{error}</div>}

            <button type="submit" className="primary-btn full-width">Open management dashboard</button>
          </form>

        </div>
      </div>
    )
  }

  if (view === 'studentPortal' && currentUser && currentUser.role === 'student') {
    return (
      <div className="page-shell portal-shell">
        <aside className="sidebar-panel">
          <div className="brand-wrap sidebar-brand">
            <div className="brand-mark"><GraduationCap size={20} /></div>
            <div>
              <div className="brand-name small-brand">CAMPUSVOICE</div>
              <div className="brand-subtext">Student portal</div>
            </div>
          </div>

          <nav className="side-nav">
            {['dashboard', 'submit', 'complaints', 'notifications', 'profile'].map((item) => (
              <button key={item} className={studentPage === item ? 'nav-item active' : 'nav-item'} onClick={() => setStudentPage(item)}>
                {item === 'dashboard' && <LayoutDashboard size={18} />}
                {item === 'submit' && <PlusCircle size={18} />}
                {item === 'complaints' && <FileText size={18} />}
                {item === 'notifications' && <Bell size={18} />}
                {item === 'profile' && <UserCircle2 size={18} />}
                {item[0].toUpperCase() + item.slice(1)}
              </button>
            ))}
          </nav>

          <div className="sidebar-card">
            <ShieldCheck size={20} />
            <div className="sidebar-card-title">Your voice matters</div>
            <p>Your grievance is handled confidentially and reviewed securely.</p>
          </div>
          <button className="ghost-btn logout-btn" onClick={handleLogout}>Log out</button>
        </aside>

        <main className="workspace-panel">
          <header className="workspace-header">
            <div>
              <div className="eyebrow-row small-row">Student portal</div>
              <h2>Welcome back, {currentUser.name.split(' ')[0]}</h2>
            </div>
            <div className="profile-pill"><UserCircle2 size={18} /> {currentUser.email}</div>
          </header>

          {studentPage === 'dashboard' && (
            <>
              <section className="hero-panel compact">
                <div className="eyebrow-row"><Sparkles size={16} /> AI-powered support</div>
                <h3>Your campus. Your voice. Your change.</h3>
                <p>Share any issue you are facing. Our platform turns it into a structured action item and helps institutions respond faster.</p>
                <button className="primary-btn" onClick={() => setStudentPage('submit')}>Submit a complaint</button>
              </section>

              <section className="stats-grid four-up">
                {[
                  { label: 'Total complaints', value: myComplaints.length },
                  { label: 'Pending', value: myComplaints.filter((item) => !['Resolved', 'Closed'].includes(item.status)).length },
                  { label: 'Under review', value: myComplaints.filter((item) => item.status === 'Under Investigation' || item.status === 'Pending Review').length },
                  { label: 'Resolved', value: myComplaints.filter((item) => item.status === 'Resolved').length },
                ].map((metric) => (
                  <div className="stat-card" key={metric.label}>
                    <div className="stat-label">{metric.label}</div>
                    <div className="stat-value">{metric.value}</div>
                  </div>
                ))}
              </section>

              <section className="panel-grid two-col">
                <div className="data-panel">
                  <div className="panel-head">
                    <h3>Recent complaints</h3>
                    <button className="ghost-btn" onClick={() => setStudentPage('complaints')}>View all</button>
                  </div>
                  <div className="stack-list">
                    {myComplaints.length === 0 ? (
                      <div className="empty-state">No complaint history yet. Submit your first report.</div>
                    ) : (
                      myComplaints.slice(0, 3).map((complaint) => (
                        <button key={complaint.id} className="complaint-mini" onClick={() => { setSelectedComplaintId(complaint.id); setStudentPage('complaints'); }}>
                          <div>
                            <div className="mini-title"><span>{complaint.id}</span> · {complaint.category}</div>
                            <div className="mini-subtitle">{complaint.summary}</div>
                          </div>
                          <div className={`badge ${STATUS_TONES[complaint.status] || 'submitted'}`}>{complaint.status}</div>
                        </button>
                      ))
                    )}
                  </div>
                </div>

                <div className="data-panel">
                  <div className="panel-head">
                    <h3>Recent updates</h3>
                  </div>
                  <div className="stack-list">
                    {visibleNotifications.length === 0 ? (
                      <div className="empty-state">No notifications. You will receive status updates here.</div>
                    ) : (
                      visibleNotifications.slice(0, 3).map((notification) => (
                        <div key={notification.id} className="notification-item">
                          <div className="notification-title">{notification.title}</div>
                          <div className="notification-text">{notification.text}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </section>
            </>
          )}

          {studentPage === 'submit' && (
            <section className="data-panel large-panel">
              <div className="panel-head">
                <h3>Submit a complaint</h3>
              </div>

              <div className="form-grid two-col">
                <label>Main category
                  <select value={complaintForm.category} onChange={(event) => {
                    const category = event.target.value
                    const categoryDetails = CATEGORY_DATA.find((item) => item.name === category) ?? CATEGORY_DATA[0]
                    setComplaintForm((previous) => ({
                      ...previous,
                      category,
                      subcategory: categoryDetails.subcategories[0],
                      customCategory: '',
                    }))
                  }}>
                    {CATEGORY_DATA.map((category) => (
                      <option key={category.name} value={category.name}>{category.name}</option>
                    ))}
                  </select>
                </label>

                <label>Subcategory
                  <select value={complaintForm.subcategory} onChange={(event) => setComplaintForm((previous) => ({ ...previous, subcategory: event.target.value, customCategory: '' }))}>
                    {selectedCategoryDetails.subcategories.map((subcategory) => (
                      <option key={subcategory} value={subcategory}>{subcategory}</option>
                    ))}
                  </select>
                </label>
              </div>

              {complaintForm.subcategory === 'Others' && (
                <label className="mt-12">Custom issue category
                  <input value={complaintForm.customCategory} onChange={(event) => setComplaintForm((previous) => ({ ...previous, customCategory: event.target.value }))} placeholder="Describe the issue type" />
                </label>
              )}

              <label className="mt-12">Describe your problem naturally
                <textarea value={complaintForm.originalComplaint} onChange={(event) => setComplaintForm((previous) => ({ ...previous, originalComplaint: event.target.value }))} rows="7" placeholder="Example: The hostel food smells stale and many students are facing stomach problems after eating." />
              </label>

              <div className="toggle-row">
                <label className="inline-toggle">
                  <input type="checkbox" checked={complaintForm.isAnonymous} onChange={(event) => setComplaintForm((previous) => ({ ...previous, isAnonymous: event.target.checked }))} />
                  <span>Submit anonymously</span>
                </label>
              </div>

              {error && <div className="error-box">{error}</div>}

              <div className="action-row">
                <button className="primary-btn" onClick={handleComplaintSubmit}>
                  <Send size={18} /> Submit complaint
                </button>
              </div>
            </section>
          )}

          {studentPage === 'complaints' && (
            <section className="data-panel large-panel">
              <div className="panel-head">
                <h3>My complaints</h3>
                <div className="filter-tools">
                  <div className="search-pill"><Search size={16} /> <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search complaints" /></div>
                  <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                    <option value="All">All statuses</option>
                    <option value="Submitted">Submitted</option>
                    <option value="AI Processing">AI Processing</option>
                    <option value="Pending Review">Pending Review</option>
                    <option value="Under Investigation">Under Investigation</option>
                    <option value="Resolved">Resolved</option>
                  </select>
                </div>
              </div>

              <div className="stack-list">
                {filteredComplaints.filter((complaint) => normalizeStudentKey(complaint.studentId, complaint.studentName) === normalizeStudentKey(currentUser.uid, currentUser.name) || complaint.studentName === currentUser.name).length === 0 ? (
                  <div className="empty-state">No complaints matched your filters.</div>
                ) : (
                  filteredComplaints.filter((complaint) => normalizeStudentKey(complaint.studentId, complaint.studentName) === normalizeStudentKey(currentUser.uid, currentUser.name) || complaint.studentName === currentUser.name).map((complaint) => (
                    <button key={complaint.id} className="complaint-row" onClick={() => setSelectedComplaintId(complaint.id)}>
                      <div>
                        <div className="complaint-header"><span>{complaint.id}</span><span className={`badge ${STATUS_TONES[complaint.status] || 'submitted'}`}>{complaint.status}</span></div>
                        <div className="mini-title">{complaint.category} · {complaint.subcategory}</div>
                        <div className="mini-subtitle">{complaint.summary}</div>
                      </div>
                      <div className="row-meta">{formatDate(complaint.createdAt)}</div>
                    </button>
                  ))
                )}
              </div>

              {selectedComplaint && (
                <div className="detail-panel">
                  <div className="panel-head">
                    <h3>Complaint details</h3>
                    <div className={`badge ${STATUS_TONES[selectedComplaint.status] || 'submitted'}`}>{selectedComplaint.status}</div>
                  </div>

                  <div className="detail-grid">
                    <div>
                      <div className="field-label">Reference</div>
                      <div className="field-value">{selectedComplaint.id}</div>
                    </div>
                    <div>
                      <div className="field-label">Priority</div>
                      <div className="field-value">{selectedComplaint.priority}</div>
                    </div>
                    <div>
                      <div className="field-label">Urgency</div>
                      <div className="field-value">{selectedComplaint.urgency}</div>
                    </div>
                    <div>
                      <div className="field-label">Department</div>
                      <div className="field-value">{selectedComplaint.department}</div>
                    </div>
                  </div>

                  <div className="content-block">
                    <div className="field-label">Original complaint</div>
                    <p>{selectedComplaint.originalComplaint}</p>
                  </div>
                  <div className="content-block">
                    <div className="field-label">AI summary</div>
                    <p>{selectedComplaint.aiAnalysis?.summary || selectedComplaint.summary}</p>
                  </div>
                  <div className="content-block">
                    <div className="field-label">Recommended action</div>
                    <p>{selectedComplaint.aiAnalysis?.recommendation || 'The responsible department should review the complaint and determine an appropriate response.'}</p>
                  </div>
                  <div className="content-block">
                    <div className="field-label">Official response</div>
                    <p>{selectedComplaint.officialResponse || 'No official response yet.'}</p>
                  </div>

                  <div className="timeline-block">
                    {selectedComplaint.statusHistory?.map((entry) => (
                      <div key={`${entry.status}-${entry.timestamp}`} className="timeline-item">
                        <div className="timeline-dot" />
                        <div>
                          <div className="timeline-status">{entry.status}</div>
                          <div className="timeline-date">{formatDate(entry.timestamp)}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {selectedComplaint.status === 'Resolved' && !selectedComplaint.studentFeedback && (
                    <div className="feedback-box">
                      <div className="field-label">How satisfied were you?</div>
                      <div className="rating-row">
                        {[1, 2, 3, 4, 5].map((value) => (
                          <button key={value} className="rating-dot" onClick={() => handleFeedback(selectedComplaint.id, value)}>{value}</button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {studentPage === 'notifications' && (
            <section className="data-panel large-panel">
              <div className="panel-head">
                <h3>Notifications</h3>
              </div>
              <div className="stack-list">
                {visibleNotifications.length === 0 ? (
                  <div className="empty-state">No notifications at the moment.</div>
                ) : (
                  visibleNotifications.map((notification) => (
                    <div key={notification.id} className="notification-card">
                      <div className="notification-title">{notification.title}</div>
                      <div className="notification-text">{notification.text}</div>
                      <div className="notification-meta">{formatDate(notification.createdAt)}</div>
                    </div>
                  ))
                )}
              </div>
            </section>
          )}

          {studentPage === 'profile' && (
            <section className="data-panel large-panel">
              <div className="panel-head"><h3>Profile</h3></div>
              <div className="profile-grid">
                <div className="profile-field"><span>Name</span><strong>{currentUser.name}</strong></div>
                <div className="profile-field"><span>Email</span><strong>{currentUser.email}</strong></div>
                <div className="profile-field"><span>Student ID</span><strong>{currentUser.studentId}</strong></div>
                <div className="profile-field"><span>Department</span><strong>{currentUser.department}</strong></div>
              </div>
            </section>
          )}
        </main>
      </div>
    )
  }

  if (view === 'adminPortal' && currentUser && hasAdminAccess(currentUser.role)) {
    const roleLabel = currentUser.role === 'superAdmin' ? 'Super Administrator' : currentUser.role === 'managementViewer' ? 'Management Viewer' : currentUser.role === 'departmentAdmin' ? 'Department Administrator' : 'Safeguarding Officer'

    return (
      <div className="page-shell portal-shell">
        <aside className="sidebar-panel">
          <div className="brand-wrap sidebar-brand">
            <div className="brand-mark"><Building2 size={20} /></div>
            <div>
              <div className="brand-name small-brand">CAMPUSVOICE</div>
              <div className="brand-subtext">Administration</div>
            </div>
          </div>

          <div className="admin-role-box">{roleLabel}</div>

          <nav className="side-nav">
            {['overview', 'groups', 'reports', 'departments', 'audit'].map((item) => (
              <button key={item} className="nav-item active" onClick={() => setStudentPage(item)}>
                {item === 'overview' && <LayoutDashboard size={17} />}
                {item === 'groups' && <MessageSquareText size={17} />}
                {item === 'reports' && <FileText size={17} />}
                {item === 'departments' && <Building2 size={17} />}
                {item === 'audit' && <ShieldCheck size={17} />}
                {item[0].toUpperCase() + item.slice(1)}
              </button>
            ))}
          </nav>

          <button className="ghost-btn logout-btn" onClick={handleLogout}>Log out</button>
        </aside>

        <main className="workspace-panel admin-panel">
          <header className="workspace-header">
            <div>
              <div className="eyebrow-row small-row">Management dashboard</div>
              <h2>Institutional intelligence overview</h2>
            </div>
            <div className="profile-pill"><UserCircle2 size={18} /> {currentUser.email}</div>
          </header>

          {studentPage === 'overview' && (
            <>
              <section className="stats-grid six-up">
                {reportCards.map((card) => {
                  const Icon = card.icon
                  return (
                    <div className={`stat-card ${cardClass(card.tone)}`} key={card.label}>
                      <div className="stat-label"><Icon size={16} /> {card.label}</div>
                      <div className="stat-value">{card.value}</div>
                    </div>
                  )
                })}
              </section>

              <section className="panel-grid two-col">
                <div className="data-panel">
                  <div className="panel-head"><h3>Critical issues</h3></div>
                  <div className="stack-list">
                    {issueGroups.filter((group) => group.priority === 'CRITICAL' || group.priority === 'HIGH').slice(0, 4).map((group) => (
                      <div key={group.id} className="issue-item">
                        <div className="issue-main">
                          <div className="mini-title">{group.title}</div>
                          <div className="mini-subtitle">{group.explanation}</div>
                        </div>
                        <div className="issue-metrics">
                          <span className="badge critical">{group.priority}</span>
                          <span>{group.distinctStudents} students</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="data-panel">
                  <div className="panel-head"><h3>Latest notifications</h3></div>
                  <div className="stack-list">
                    {data.notifications.slice(0, 5).map((notification) => (
                      <div key={notification.id} className="notification-item">
                        <div className="notification-title">{notification.title}</div>
                        <div className="notification-text">{notification.text}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <section className="chart-grid">
                <div className="chart-card">
                  <div className="panel-head"><h3>Category distribution</h3></div>
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie data={categoryChartData} dataKey="value" nameKey="name" innerRadius={40} outerRadius={80} paddingAngle={2}>
                        {categoryChartData.map((entry, index) => (
                          <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div className="chart-card">
                  <div className="panel-head"><h3>Priority distribution</h3></div>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={priorityChartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="value" fill="#1d4ed8" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>
            </>
          )}

          {studentPage === 'groups' && (
            <section className="data-panel large-panel">
              <div className="panel-head"><h3>Issue groups</h3></div>
              <div className="issue-list">
                {issueGroups.map((group) => (
                  <div key={group.id} className="issue-group-card">
                    <div className="issue-top">
                      <div>
                        <div className="mini-title">{group.title}</div>
                        <div className="mini-subtitle">{group.explanation}</div>
                      </div>
                      <div className={`badge ${group.priority === 'CRITICAL' ? 'critical' : group.priority === 'HIGH' ? 'warning' : 'submitted'}`}>{group.priority}</div>
                    </div>
                    <div className="issue-foot">
                      <span>{group.distinctStudents} distinct students</span>
                      <span>{group.count} complaint records</span>
                      <span>{group.department}</span>
                      <span>{group.groupingMethod === 'embedding' ? 'Gemini semantic similarity' : 'Database category match'}</span>
                    </div>
                    {currentUser.role !== 'managementViewer' && (
                      <div className="filter-tools">
                        {group.complaints.map((complaint) => (
                          <div key={complaint.id} className="filter-tools">
                            <strong>{complaint.id}</strong>
                            <select
                              value={complaint.status}
                              onChange={(event) => handleComplaintUpdate(complaint.id, event.target.value)}
                              disabled={currentUser.role === 'safeguardingOfficer' && !complaint.safetyFlags?.length}
                            >
                              <option value="Submitted">Submitted</option>
                              <option value="AI Processing">AI Processing</option>
                              <option value="Pending Review">Pending Review</option>
                              <option value="Assigned">Assigned</option>
                              <option value="Under Investigation">Under Investigation</option>
                              <option value="In Progress">In Progress</option>
                              <option value="Resolved">Resolved</option>
                              <option value="Reopened">Reopened</option>
                              <option value="Closed">Closed</option>
                            </select>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {studentPage === 'reports' && (
            <section className="data-panel large-panel">
              <div className="panel-head">
                <h3>Reports and analytics</h3>
                <div className="filter-tools">
                  <button className="ghost-btn" onClick={exportCsvReport}>Export CSV</button>
                  <button className="ghost-btn" onClick={exportPdfReport}>Export PDF</button>
                  <select value={reportRange} onChange={(event) => setReportRange(event.target.value)}>
                    <option value="week">Current week</option>
                    <option value="month">Current month</option>
                    <option value="quarter">Last 3 months</option>
                    <option value="custom">Custom period</option>
                  </select>
                </div>
              </div>

              {reportRange === 'custom' && (
                <div className="filter-tools">
                  <label>From
                    <input type="date" value={customRange.startDate} onChange={(event) => setCustomRange((range) => ({ ...range, startDate: event.target.value }))} />
                  </label>
                  <label>To
                    <input type="date" value={customRange.endDate} onChange={(event) => setCustomRange((range) => ({ ...range, endDate: event.target.value }))} />
                  </label>
                </div>
              )}

              <div className="stats-grid four-up compact-grid">
                <div className="stat-card"><div className="stat-label">Complaints</div><div className="stat-value">{reportSummary?.total ?? '—'}</div></div>
                <div className="stat-card"><div className="stat-label">Unique students</div><div className="stat-value">{reportSummary?.distinctStudents ?? '—'}</div></div>
                <div className="stat-card"><div className="stat-label">Resolution rate</div><div className="stat-value">{reportSummary ? `${Math.round(reportSummary.resolutionRate)}%` : '—'}</div></div>
                <div className="stat-card"><div className="stat-label">Group count</div><div className="stat-value">{reportSummary?.issueGroupCount ?? '—'}</div></div>
              </div>

              {reportSummary?.aiSummary?.summary ? (
                <div className="notification-card">
                  <div className="notification-title">Gemini management summary</div>
                  <div className="notification-text">{reportSummary.aiSummary.summary}</div>
                  {reportSummary.aiSummary.recommendations.map((recommendation, index) => (
                    <div className="notification-text" key={`${index}-${recommendation}`}>{recommendation}</div>
                  ))}
                </div>
              ) : (
                <div className="notification-text">
                  {reportSummary?.aiSummaryStatus === 'unavailable'
                    ? 'Management summary unavailable; aggregate report data is still available.'
                    : 'Loading report data...'}
                </div>
              )}

              <div className="chart-grid two-col-charts">
                <div className="chart-card">
                  <div className="panel-head"><h3>Department trends</h3></div>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={reportDepartmentChartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="value" fill="#0f766e" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="chart-card">
                  <div className="panel-head"><h3>Weekly complaint trend</h3></div>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={weeklyTrendData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Line type="monotone" stroke="#1d4ed8" dataKey="value" strokeWidth={3} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </section>
          )}

          {studentPage === 'departments' && (
            <section className="data-panel large-panel">
              <div className="panel-head"><h3>Department management</h3></div>
              <div className="stack-list">
                {DEFAULT_DEPARTMENTS.map((department) => (
                  <div key={department} className="notification-card">
                    <div className="notification-title">{department}</div>
                    <div className="notification-text">Assigned complaint handling and issue review for this department.</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {studentPage === 'audit' && (
            <section className="data-panel large-panel">
              <div className="panel-head"><h3>Audit logs</h3></div>
              <div className="stack-list">
                <div className="notification-card">
                  <div className="notification-title">Data retention policy active</div>
                  <div className="notification-text">Student complaint records remain confidential and are only visible to authorised personnel.</div>
                </div>
                <div className="notification-card">
                  <div className="notification-title">Safety escalations tracked</div>
                  <div className="notification-text">Critical cases are retained separately for human review and safeguarding follow-up.</div>
                </div>
              </div>
            </section>
          )}
        </main>
      </div>
    )
  }

  return (
    <div className="page-shell auth-shell">
      <div className="auth-card wide">
        <div className="auth-topbar">
          <button className="ghost-btn" onClick={() => setView('landing')}>← Home</button>
        </div>
        <div className="auth-heading">
          <h2>Access required</h2>
          <p>Select a valid portal and sign in to continue.</p>
        </div>
        <button className="primary-btn full-width" onClick={() => setView('landing')}>Return to landing page</button>
      </div>
    </div>
  )
}

export default App
