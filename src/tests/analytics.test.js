import { describe, expect, it } from 'vitest'
import {
  buildIssueGroups,
  buildReportSnapshot,
  buildWeeklyTrend,
  computeAnalytics,
  semanticSimilarityScore,
} from '../utils/analytics.js'

describe('CampusVoice AI analytics helpers', () => {
  it('groups similar complaints into a single issue group', () => {
    const complaints = [
      {
        id: 'a',
        category: 'Hostel',
        subcategory: 'Food quality',
        department: 'Hostel Administration',
        studentId: 'student-1',
        createdAt: '2025-02-01T08:00:00.000Z',
        updatedAt: '2025-02-01T08:30:00.000Z',
        status: 'Under Investigation',
        priority: 'HIGH',
        urgency: 'URGENT',
        summary: 'Food smells stale',
        aiAnalysis: { summary: 'Food smells stale', explanation: 'Recurring issue' },
      },
      {
        id: 'b',
        category: 'Hostel',
        subcategory: 'Food quality',
        department: 'Hostel Administration',
        studentId: 'student-2',
        createdAt: '2025-02-04T08:00:00.000Z',
        updatedAt: '2025-02-04T08:30:00.000Z',
        status: 'Submitted',
        priority: 'MEDIUM',
        urgency: 'NORMAL',
        summary: 'Mess food is low quality',
        aiAnalysis: { summary: 'Mess food is low quality', explanation: 'Recurring issue' },
      },
    ]

    const groups = buildIssueGroups(complaints)
    expect(groups).toHaveLength(1)
    expect(groups[0].distinctStudents).toBe(2)
  })

  it('computes category and resolution metrics correctly', () => {
    const complaints = [
      {
        id: 'c1',
        category: 'Hostel',
        priority: 'HIGH',
        status: 'Resolved',
        studentId: 's1',
      },
      {
        id: 'c2',
        category: 'Infrastructure',
        priority: 'MEDIUM',
        status: 'Under Investigation',
        studentId: 's2',
      },
      {
        id: 'c3',
        category: 'Hostel',
        priority: 'LOW',
        status: 'Resolved',
        studentId: 's3',
      },
    ]

    const analytics = computeAnalytics(complaints)
    expect(analytics.total).toBe(3)
    expect(analytics.uniqueStudents).toBe(3)
    expect(analytics.byPriority.HIGH).toBe(1)
    expect(analytics.resolutions).toBe(2)
    expect(analytics.resolutionRate).toBeCloseTo(66.67, 1)
  })

  it('groups semantically similar Gemini embeddings and counts each student UID once', () => {
    const complaints = [
      {
        id: 'semantic-a',
        studentUid: 'student-1',
        category: 'Hostel',
        subcategory: 'Food quality',
        department: 'Hostel Administration',
        createdAt: '2026-11-10T08:00:00.000Z',
        summary: 'Meal quality is poor.',
        semanticEmbedding: [0.99, 0.1, 0.02],
      },
      {
        id: 'semantic-b',
        studentUid: 'student-1',
        category: 'Hostel',
        subcategory: 'Food quantity',
        department: 'Hostel Administration',
        createdAt: '2026-11-11T08:00:00.000Z',
        summary: 'Students receive insufficient meals.',
        semanticEmbedding: [0.98, 0.12, 0.03],
      },
      {
        id: 'semantic-c',
        studentUid: 'student-2',
        category: 'Hostel',
        subcategory: 'Food quality',
        department: 'Hostel Administration',
        createdAt: '2026-11-12T08:00:00.000Z',
        summary: 'Meals are regularly undercooked.',
        semanticEmbedding: [0.97, 0.11, 0.02],
      },
      {
        id: 'unrelated',
        studentUid: 'student-3',
        category: 'Hostel',
        subcategory: 'Food quality',
        department: 'Hostel Administration',
        createdAt: '2026-11-12T09:00:00.000Z',
        summary: 'The campus network disconnects.',
        semanticEmbedding: [0, 0.01, 1],
      },
    ]

    const groups = buildIssueGroups(complaints)
    const foodGroup = groups.find((group) => group.complaintIds.includes('semantic-a'))

    expect(semanticSimilarityScore([1, 0], [1, 0])).toBe(1)
    expect(groups).toHaveLength(2)
    expect(foodGroup.groupingMethod).toBe('embedding')
    expect(foodGroup.count).toBe(3)
    expect(foodGroup.distinctStudents).toBe(2)
  })

  it('counts unique complainants by student UID rather than by complaint or display name', () => {
    const analytics = computeAnalytics([
      { id: 'one', studentUid: 'student-1', studentName: 'A. Student' },
      { id: 'two', studentUid: 'student-1', studentName: 'A. Student' },
      { id: 'three', studentUid: 'student-2', studentName: 'A. Student' },
      { id: 'anonymous-without-id', studentName: 'Anonymous Student' },
    ])

    expect(analytics.uniqueStudents).toBe(2)
  })

  it('filters reports by real week, month, and custom-date boundaries', () => {
    const now = new Date(2026, 10, 15, 12)
    const complaints = [
      { id: 'october', studentUid: 's1', createdAt: new Date(2026, 9, 31, 12).toISOString() },
      { id: 'november', studentUid: 's2', createdAt: new Date(2026, 10, 1, 12).toISOString() },
      { id: 'current-week', studentUid: 's3', createdAt: new Date(2026, 10, 10, 12).toISOString() },
    ]

    expect(buildReportSnapshot(complaints, 'week', {}, now).total).toBe(1)
    expect(buildReportSnapshot(complaints, 'month', {}, now).total).toBe(2)
    expect(buildReportSnapshot(complaints, 'custom', {
      startDate: '2026-11-01',
      endDate: '2026-11-10',
    }, now).total).toBe(2)
    expect(buildReportSnapshot(complaints, 'custom', {
      startDate: '2026-11-11',
      endDate: '2026-11-10',
    }, now).total).toBe(0)
  })

  it('builds weekly trend buckets from complaint timestamps', () => {
    const trend = buildWeeklyTrend([
      { createdAt: new Date(2026, 9, 20, 12).toISOString() },
      { createdAt: new Date(2026, 9, 30, 12).toISOString() },
      { createdAt: new Date(2026, 10, 3, 12).toISOString() },
      { createdAt: new Date(2026, 10, 11, 12).toISOString() },
    ], new Date(2026, 10, 15, 12))

    expect(trend.map(({ value }) => value)).toEqual([1, 1, 1, 1])
  })
})
