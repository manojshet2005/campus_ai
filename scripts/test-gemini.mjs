import { GoogleGenAI } from '@google/genai'

const apiKey = process.env.GEMINI_API_KEY
if (!apiKey) {
  console.error('GEMINI_API_KEY is not available.')
  process.exit(1)
}

try {
  const ai = new GoogleGenAI({ apiKey })
  const textModel = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite'
  const textResponse = await ai.models.generateContent({
    model: textModel,
    contents: 'Return valid JSON only: {"status":"ok"}',
    config: { responseMimeType: 'application/json' },
  })
  console.log(JSON.stringify({
    textRequest: 'succeeded',
    model: textModel,
    hasText: Boolean(textResponse.text),
  }))

  const complaintResponse = await ai.models.generateContent({
    model: textModel,
    contents: `Return only valid JSON with:
summary, category, subcategory, suggestedDepartment, priority, urgency, sentiment, issueType, keywords, safetyFlags, requiresHumanReview, explanation, recommendation.
Analyze: "The hostel drinking water smells bad and several students are ill."`,
    config: { responseMimeType: 'application/json' },
  })
  const complaintJson = JSON.parse(complaintResponse.text)
  console.log(JSON.stringify({
    complaintAnalysisRequest: 'succeeded',
    hasRequiredFields: Boolean(
      complaintJson.summary
      && complaintJson.category
      && complaintJson.priority
      && complaintJson.urgency
      && complaintJson.sentiment
    ),
  }))

  const embeddingModel = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2'
  const embeddingResponse = await ai.models.embedContent({
    model: embeddingModel,
    contents: 'Campus hostel drinking water is dirty.',
    config: { outputDimensionality: 768 },
  })
  const values = embeddingResponse.embeddings?.[0]?.values
  console.log(JSON.stringify({
    embeddingRequest: 'succeeded',
    model: embeddingModel,
    dimensions: Array.isArray(values) ? values.length : 0,
  }))
} catch (error) {
  console.error(JSON.stringify({
    request: 'failed',
    status: error?.status ?? null,
    statusText: error?.statusText ?? null,
    message: error?.message ?? 'Unknown Gemini request failure',
  }))
  process.exit(1)
}
