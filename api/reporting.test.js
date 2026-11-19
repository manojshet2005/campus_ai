import { describe, expect, it } from 'vitest'
import { aggregateComplaintRecords } from './reporting.js'

describe('aggregateComplaintRecords', () => {
  it('counts unique student IDs rather than complaint records', () => {
    const report = aggregateComplaintRecords([
      { student_id: 'student-a', status: 'Resolved', priority: 'HIGH', category: 'Hostel', department: 'Housing' },
      { student_id: 'student-a', status: 'Submitted', priority: 'CRITICAL', category: 'Hostel', department: 'Housing' },
      { student_id: 'student-b', status: 'Closed', priority: 'LOW', category: 'Transport', department: 'Transit' },
    ], { groupCount: 2 })

    expect(report.total).toBe(3)
    expect(report.distinctStudents).toBe(2)
    expect(report.resolved).toBe(2)
    expect(report.resolutionRate).toBeCloseTo(66.67, 1)
    expect(report.byPriority.CRITICAL).toBe(1)
    expect(report.categoryStats).toContainEqual({ name: 'Hostel', count: 2 })
    expect(report.issueGroupCount).toBe(2)
  })

  it('calculates the six weekly buckets from complaint timestamps', () => {
    const now = new Date('2026-06-18T12:00:00Z')
    const report = aggregateComplaintRecords([
      { student_id: 'a', status: 'Submitted', priority: 'MEDIUM', created_at: '2026-06-15T10:00:00Z' },
      { student_id: 'b', status: 'Submitted', priority: 'MEDIUM', created_at: '2026-06-07T10:00:00Z' },
      { student_id: 'c', status: 'Submitted', priority: 'MEDIUM', created_at: '2026-06-18T10:00:00Z' },
    ], { now })

    expect(report.weeklyTrend).toHaveLength(6)
    expect(report.weeklyTrend[3].value).toBe(1)
    expect(report.weeklyTrend[4].value).toBe(0)
    expect(report.weeklyTrend[5].value).toBe(2)
    expect(report.total).toBe(3)
  })
})
