import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const API_URL = process.env.EVOLUTION_API_URL;
const API_KEY = process.env.EVOLUTION_API_KEY;
const INSTANCE = process.env.EVOLUTION_INSTANCE_NAME;

/**
 * Sends a text message to a specific WhatsApp number via Evolution API.
 * @param {string} phoneNumber - The recipient's WhatsApp number (e.g., "2348138412871")
 * @param {string} text - The message content
 */
export async function sendWhatsAppMessage(phoneNumber, text) {
  try {
    const response = await axios.post(
      `${API_URL}/message/sendText/${INSTANCE}`,
      {
        number: phoneNumber,
        text: text,
        delay: 1500 // Adds a slight artificial typing delay for a natural feel
      },
      {
        headers: {
          'apikey': API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log(`✅ Message sent to ${phoneNumber}`);
    return response.data;
  } catch (error) {
    console.error(`❌ Error sending message to ${phoneNumber}:`, error.response?.data || error.message);
  }
}


export async function downloadWhatsAppMedia(messageKey) {
  const evolutionApiUrl = process.env.EVOLUTION_API_URL;
  const instanceName = process.env.EVOLUTION_INSTANCE_NAME;
  const apiKey = process.env.EVOLUTION_API_KEY;

  if (!evolutionApiUrl || !instanceName || !apiKey) {
    throw new Error("Evolution API credentials missing in .env");
  }

  // Evolution API endpoint to download base64 media
  const endpoint = `${evolutionApiUrl}/chat/getBase64FromMediaMessage/${instanceName}`;
  
  const response = await axios.post(endpoint, {
    message: { key: messageKey }
  }, {
    headers: {
      'apikey': apiKey,
      'Content-Type': 'application/json'
    }
  });

  const base64Data = response.data.base64;
  if (!base64Data) {
    throw new Error("Failed to retrieve base64 audio data from Evolution API.");
  }

  // Convert the base64 string back into a raw Buffer that Groq Whisper can read
  return Buffer.from(base64Data.split(',')[1] || base64Data, 'base64');
}