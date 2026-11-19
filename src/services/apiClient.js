async function request(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
    credentials: 'include',
  })
  const body = await response.json().catch(() => ({ error: 'The server returned an invalid response.' }))
  if (!response.ok) throw new Error(body.error || 'Request failed.')
  return body
}

export function normalizeComplaint(row) {
  let semanticEmbedding
  if (typeof row.embedding_text === 'string') {
    try {
      semanticEmbedding = JSON.parse(row.embedding_text)
    } catch {
      semanticEmbedding = undefined
    }
  }
  return {
    id: row.public_id || row.publicId || row.id,
    databaseId: row.id,
    studentId: row.student_id || row.studentId,
    studentName: row.student_name || 'Student',
    category: row.category || row.selected_category,
    subcategory: row.subcategory || row.selected_subcategory,
    customCategory: row.custom_category || '',
    originalComplaint: row.original_complaint || '',
    summary: row.summary || '',
    priority: row.priority || 'MEDIUM',
    urgency: row.urgency || 'NORMAL',
    sentiment: row.sentiment || 'NEUTRAL',
    status: row.status || 'Submitted',
    department: row.department || row.suggested_department || 'General Administration',
    createdAt: row.created_at || row.createdAt,
    updatedAt: row.updated_at || row.updatedAt,
    aiAnalysis: row.summary ? {
      summary: row.summary,
      priority: row.priority,
      urgency: row.urgency,
      sentiment: row.sentiment,
      recommendation: row.recommendation,
      safetyFlags: row.safety_flags || [],
    } : null,
    safetyFlags: row.safety_flags || [],
    isAnonymous: row.is_anonymous || false,
    isSafetyRestricted: row.is_safety_restricted || false,
    officialResponse: row.official_response || '',
    semanticEmbedding,
    statusHistory: (row.status_history || []).map((entry) => ({
      status: entry.status,
      timestamp: entry.timestamp,
    })),
  }
}

export const api = {
  health: () => request('/health'),
  session: () => request('/auth/session'),
  register: (data) => request('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  login: (data) => request('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  logout: () => request('/auth/logout', { method: 'POST', body: '{}' }),
  complaints: () => request('/complaints'),
  submitComplaint: (data) => request('/complaints', { method: 'POST', body: JSON.stringify(data) }),
  updateComplaint: (id, data) => request(`/complaints/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(data) }),
  analytics: () => request('/analytics'),
  issueGroups: () => request('/issue-groups'),
  createReport: (data) => request('/reports', { method: 'POST', body: JSON.stringify(data) }),
  notifications: () => request('/notifications'),
  feedback: (id, data) => request(`/complaints/${encodeURIComponent(id)}/feedback`, { method: 'POST', body: JSON.stringify(data) }),
}
