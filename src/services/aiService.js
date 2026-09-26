import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/**
 * Generate a response from Gemini AI
 * @param {string} prompt - User message and system context
 * @returns {Promise<string>} - Model text response
 */
export async function generateAIResponse(prompt) {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
    });

    return response.text;
  } catch (error) {
    console.error('Gemini API Error:', error);
    throw error;
  }
}