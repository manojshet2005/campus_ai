import { CATEGORY_DATA } from '../data/seedData.js'

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
const URGENCIES = ['LOW', 'NORMAL', 'URGENT', 'IMMEDIATE']
const SENTIMENTS = ['ANGRY', 'FRUSTRATED', 'FEARFUL', 'POSITIVE', 'DISTRESSED', 'NEGATIVE']
const DEPARTMENTS = [
  'Hostel Administration',
  'Academic Administration',
  'Examination Department',
  'Faculty Administration',
  'Canteen Management',
  'Infrastructure Department',
  'Transport Department',
  'Student Welfare',
  'Placement Cell',
  'General Administration',
]

function isNonEmptyString(value, maxLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength
}

export function validateGeminiAnalysis(value) {
  const validCategories = CATEGORY_DATA.map(({ name }) => name)

  if (
    !value
    || !isNonEmptyString(value.summary, 500)
    || !validCategories.includes(value.category)
    || !isNonEmptyString(value.subcategory, 120)
    || !DEPARTMENTS.includes(value.suggestedDepartment)
    || !PRIORITIES.includes(value.priority)
    || !URGENCIES.includes(value.urgency)
    || !SENTIMENTS.includes(value.sentiment)
    || !isNonEmptyString(value.issueType, 240)
    || !Array.isArray(value.keywords)
    || value.keywords.length > 12
    || !value.keywords.every((item) => isNonEmptyString(item, 80))
    || !Array.isArray(value.safetyFlags)
    || value.safetyFlags.length > 20
    || !value.safetyFlags.every((item) => isNonEmptyString(item, 120))
    || typeof value.requiresHumanReview !== 'boolean'
    || !isNonEmptyString(value.explanation, 1200)
    || !isNonEmptyString(value.recommendation, 1200)
  ) {
    throw new Error('Gemini returned an invalid complaint analysis response.')
  }

  return value
}
