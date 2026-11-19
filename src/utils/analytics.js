import { CATEGORY_DATA } from '../data/seedData.js'

const PRIORITY_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
const URGENCY_LEVELS = ['LOW', 'NORMAL', 'URGENT', 'IMMEDIATE']

export function normalizeText(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeStudentKey(studentId) {
  if (studentId && String(studentId).trim()) {
    return String(studentId).trim().toLowerCase()
  }

  return ''
}

export function coalesceNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback
}

export function getDepartmentForCategory(categoryName) {
  const config = CATEGORY_DATA.find((category) => category.name === categoryName)
  return config?.department ?? 'General Administration'
}

export function semanticSimilarityScore(leftEmbedding = [], rightEmbedding = []) {
  if (
    !Array.isArray(leftEmbedding)
    || !Array.isArray(rightEmbedding)
    || leftEmbedding.length === 0
    || leftEmbedding.length !== rightEmbedding.length
    || !leftEmbedding.every(Number.isFinite)
    || !rightEmbedding.every(Number.isFinite)
  ) {
    return 0
  }

  let dotProduct = 0
  let leftMagnitude = 0
  let rightMagnitude = 0

  for (let index = 0; index < leftEmbedding.length; index += 1) {
    dotProduct += leftEmbedding[index] * rightEmbedding[index]
    leftMagnitude += leftEmbedding[index] ** 2
    rightMagnitude += rightEmbedding[index] ** 2
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) return 0
  return dotProduct / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude))
}

export function getPriorityWeight(priority) {
  return PRIORITY_LEVELS.indexOf(priority) + 1
}

export function getUrgencyWeight(urgency) {
  return URGENCY_LEVELS.indexOf(urgency) + 1
}

export function buildIssueGroups(complaints = []) {
  const groups = []

  complaints.forEach((complaint) => {
    const embedding = complaint.semanticEmbedding
    const candidateGroup = groups.find((group) => {
      const sameDepartment = (group.department || '').toLowerCase() === (complaint.department || '').toLowerCase()
      if (!sameDepartment) return false

      if (Array.isArray(embedding) && Array.isArray(group.semanticEmbedding)) {
        return semanticSimilarityScore(group.semanticEmbedding, embedding) >= 0.78
      }

      return !embedding
        && !group.semanticEmbedding
        && group.category === (complaint.category || 'General')
        && group.subcategory === complaint.subcategory
    })

    if (candidateGroup) {
      candidateGroup.complaintIds.push(complaint.id)
      candidateGroup.complaints.push(complaint)
      const studentKey = normalizeStudentKey(complaint.studentUid || complaint.studentId)
      if (studentKey) candidateGroup.distinctStudents.add(studentKey)
      candidateGroup.firstReported = new Date(candidateGroup.firstReported) <= new Date(complaint.createdAt) ? candidateGroup.firstReported : complaint.createdAt
      candidateGroup.latestReported = new Date(candidateGroup.latestReported) >= new Date(complaint.updatedAt || complaint.createdAt) ? candidateGroup.latestReported : complaint.updatedAt || complaint.createdAt
      candidateGroup.priority = getPriorityWeight(complaint.priority || 'MEDIUM') > getPriorityWeight(candidateGroup.priority) ? complaint.priority : candidateGroup.priority
      candidateGroup.urgency = getUrgencyWeight(complaint.urgency || 'NORMAL') > getUrgencyWeight(candidateGroup.urgency) ? complaint.urgency : candidateGroup.urgency
      candidateGroup.status = complaint.status || candidateGroup.status
      candidateGroup.summary = complaint.aiAnalysis?.summary || complaint.summary || candidateGroup.summary
      candidateGroup.explanation = complaint.aiAnalysis?.explanation || complaint.summary || candidateGroup.explanation
      candidateGroup.groupingMethod = embedding ? 'embedding' : 'category'
      return
    }

    const groupSummary = complaint.aiAnalysis?.summary || complaint.summary || complaint.originalComplaint || 'Campus complaint'
    groups.push({
      id: `issue-${String(complaint.id).toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
      title: `${complaint.category} - ${complaint.subcategory}`,
      category: complaint.category,
      subcategory: complaint.subcategory,
      department: complaint.department || getDepartmentForCategory(complaint.category),
      complaintIds: [complaint.id],
      distinctStudents: new Set([normalizeStudentKey(complaint.studentUid || complaint.studentId)].filter(Boolean)),
      complaints: [complaint],
      firstReported: complaint.createdAt,
      latestReported: complaint.updatedAt || complaint.createdAt,
      priority: complaint.priority || 'MEDIUM',
      urgency: complaint.urgency || 'NORMAL',
      summary: groupSummary,
      explanation: complaint.aiAnalysis?.explanation || complaint.summary || 'Recurring issue requiring institutional review.',
      status: complaint.status || 'Submitted',
      semanticEmbedding: embedding,
      groupingMethod: embedding ? 'embedding' : 'category',
    })
  })

  return groups.map((group) => ({
    ...group,
    count: group.complaints.length,
    distinctStudents: group.distinctStudents.size,
    complaintIds: [...new Set(group.complaintIds)],
  }))
}

export function computeAnalytics(complaints = []) {
  const total = complaints.length
  const uniqueStudents = new Set(
    complaints
      .map((complaint) => normalizeStudentKey(complaint.studentUid || complaint.studentId))
      .filter(Boolean),
  ).size
  const byPriority = {
    CRITICAL: complaints.filter((complaint) => complaint.priority === 'CRITICAL').length,
    HIGH: complaints.filter((complaint) => complaint.priority === 'HIGH').length,
    MEDIUM: complaints.filter((complaint) => complaint.priority === 'MEDIUM').length,
    LOW: complaints.filter((complaint) => complaint.priority === 'LOW').length,
  }
  const byStatus = {
    Submitted: complaints.filter((complaint) => complaint.status === 'Submitted').length,
    'AI Processing': complaints.filter((complaint) => complaint.status === 'AI Processing').length,
    'Pending Review': complaints.filter((complaint) => complaint.status === 'Pending Review').length,
    Assigned: complaints.filter((complaint) => complaint.status === 'Assigned').length,
    'Under Investigation': complaints.filter((complaint) => complaint.status === 'Under Investigation').length,
    'In Progress': complaints.filter((complaint) => complaint.status === 'In Progress').length,
    Resolved: complaints.filter((complaint) => complaint.status === 'Resolved').length,
    Reopened: complaints.filter((complaint) => complaint.status === 'Reopened').length,
    Closed: complaints.filter((complaint) => complaint.status === 'Closed').length,
  }
  const categoryStats = CATEGORY_DATA.map((category) => ({
    name: category.name,
    count: complaints.filter((complaint) => complaint.category === category.name).length,
  })).filter((entry) => entry.count > 0)

  const deptStats = Object.values(
    complaints.reduce((acc, complaint) => {
      const dept = complaint.department || 'General Administration'
      acc[dept] = acc[dept] ?? { name: dept, count: 0 }
      acc[dept].count += 1
      return acc
    }, {}),
  )

  const resolved = byStatus.Resolved + byStatus.Closed
  const resolutionRate = total > 0 ? (resolved / total) * 100 : 0

  return {
    total,
    uniqueStudents,
    resolutions: resolved,
    resolutionRate,
    byPriority,
    byStatus,
    categoryStats,
    deptStats,
  }
}

export function filterComplaintsByRange(complaints = [], range, customRange = {}, now = new Date()) {
  const start = new Date(now)
  let end = new Date(now)

  if (range === 'week') {
    start.setHours(0, 0, 0, 0)
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  } else if (range === 'month') {
    start.setDate(1)
    start.setHours(0, 0, 0, 0)
  } else if (range === 'quarter') {
    start.setDate(1)
    start.setMonth(start.getMonth() - 2)
    start.setHours(0, 0, 0, 0)
  } else if (range === 'custom') {
    if (!customRange.startDate || !customRange.endDate) return []
    start.setTime(new Date(`${customRange.startDate}T00:00:00`).getTime())
    end.setTime(new Date(`${customRange.endDate}T23:59:59.999`).getTime())
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) {
      return []
    }
  } else {
    start.setDate(1)
    start.setHours(0, 0, 0, 0)
  }

  return complaints.filter((complaint) => {
    if (!complaint.createdAt) return false
    const complaintDate = typeof complaint.createdAt.toDate === 'function'
      ? complaint.createdAt.toDate()
      : new Date(complaint.createdAt)
    return Number.isFinite(complaintDate.getTime())
      && complaintDate >= start
      && complaintDate <= end
  })
}

export function buildReportSnapshot(complaints = [], range = 'month', customRange = {}, now = new Date()) {
  const filtered = filterComplaintsByRange(complaints, range, customRange, now)
  const analytics = computeAnalytics(filtered)
  const issueGroups = buildIssueGroups(filtered)

  return {
    range,
    total: filtered.length,
    uniqueStudents: analytics.uniqueStudents,
    analytics,
    issueGroupCount: issueGroups.length,
    issueGroups: issueGroups.slice(0, 5),
  }
}

export function buildWeeklyTrend(complaints = [], now = new Date()) {
  const currentWeekStart = new Date(now)
  currentWeekStart.setHours(0, 0, 0, 0)
  currentWeekStart.setDate(currentWeekStart.getDate() - ((currentWeekStart.getDay() + 6) % 7))

  return Array.from({ length: 4 }, (_, index) => {
    const start = new Date(currentWeekStart)
    start.setDate(start.getDate() - (3 - index) * 7)
    const end = new Date(start)
    end.setDate(end.getDate() + 7)

    return {
      name: start.toLocaleDateString('en', { month: 'short', day: 'numeric' }),
      value: complaints.filter((complaint) => {
        const createdAt = typeof complaint.createdAt?.toDate === 'function'
          ? complaint.createdAt.toDate()
          : new Date(complaint.createdAt)
        return Number.isFinite(createdAt.getTime()) && createdAt >= start && createdAt < end
      }).length,
    }
  })
}

export function createNotification({ title, text, recipient = 'system' }) {
  return {
    id: `n-${Date.now()}`,
    title,
    text,
    recipient,
    createdAt: new Date().toISOString(),
    read: false,
  }
}
