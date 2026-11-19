const STATUSES = [
  'Submitted',
  'AI Processing',
  'Pending Review',
  'Assigned',
  'Under Investigation',
  'In Progress',
  'Resolved',
  'Reopened',
  'Closed',
]

const PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']

function countBy(rows, field) {
  return Object.entries(rows.reduce((counts, row) => {
    const value = row[field] || 'Unspecified'
    counts[value] = (counts[value] || 0) + 1
    return counts
  }, {}))
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count)
}

function buildWeeklyTrend(rows, now) {
  const currentWeek = new Date(now)
  currentWeek.setUTCHours(0, 0, 0, 0)
  currentWeek.setUTCDate(currentWeek.getUTCDate() - ((currentWeek.getUTCDay() + 6) % 7))

  return Array.from({ length: 6 }, (_, index) => {
    const start = new Date(currentWeek)
    start.setUTCDate(start.getUTCDate() - (5 - index) * 7)
    const end = new Date(start)
    end.setUTCDate(end.getUTCDate() + 7)
    return {
      name: start.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
      value: rows.filter((row) => {
        const createdAt = new Date(row.created_at)
        return createdAt >= start && createdAt < end
      }).length,
    }
  })
}

export function aggregateComplaintRecords(rows, { groupCount = 0, now = new Date() } = {}) {
  if (!Array.isArray(rows)) throw new TypeError('Complaint rows must be an array.')
  const resolved = rows.filter((row) => ['Resolved', 'Closed'].includes(row.status)).length
  const distinctStudents = new Set(rows.map((row) => row.student_id).filter(Boolean)).size
  const byPriority = Object.fromEntries(PRIORITIES.map((priority) => [
    priority,
    rows.filter((row) => row.priority === priority).length,
  ]))
  const byStatus = Object.fromEntries(STATUSES.map((status) => [
    status,
    rows.filter((row) => row.status === status).length,
  ]))

  return {
    total: rows.length,
    distinctStudents,
    uniqueStudents: distinctStudents,
    resolved,
    unresolved: rows.length - resolved,
    resolutionRate: rows.length ? (resolved / rows.length) * 100 : 0,
    critical: byPriority.CRITICAL,
    byPriority,
    byStatus,
    categoryStats: countBy(rows, 'category'),
    deptStats: countBy(rows, 'department'),
    issueGroupCount: groupCount,
    safetyRestricted: rows.filter((row) => row.is_safety_restricted).length,
    weeklyTrend: buildWeeklyTrend(rows, now),
  }
}
