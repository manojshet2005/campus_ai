import { describe, expect, it } from 'vitest'
import { validateGeminiAnalysis } from '../services/analysisValidation.js'

const validAnalysis = {
  summary: 'Library connectivity is intermittently unavailable.',
  category: 'Infrastructure',
  subcategory: 'Internet and Wi-Fi',
  suggestedDepartment: 'Infrastructure Department',
  priority: 'MEDIUM',
  urgency: 'NORMAL',
  sentiment: 'FRUSTRATED',
  issueType: 'Campus network access',
  keywords: ['library connectivity'],
  safetyFlags: [],
  requiresHumanReview: false,
  explanation: 'A facilities team should investigate the reported outages.',
  recommendation: 'The campus network team should check the access points in the library.',
}

describe('Gemini response validation', () => {
  it('accepts a complete typed analysis response', () => {
    expect(validateGeminiAnalysis(validAnalysis)).toEqual(validAnalysis)
  })

  it('rejects malformed or out-of-range model output', () => {
    expect(() => validateGeminiAnalysis({ ...validAnalysis, priority: 'SEVERE' }))
      .toThrow('Gemini returned an invalid complaint analysis response.')
    expect(() => validateGeminiAnalysis({ ...validAnalysis, safetyFlags: 'none' }))
      .toThrow('Gemini returned an invalid complaint analysis response.')
    expect(() => validateGeminiAnalysis({ ...validAnalysis, category: 'Unknown category' }))
      .toThrow('Gemini returned an invalid complaint analysis response.')
  })
})
