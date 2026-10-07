import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Sends a text message to a specific WhatsApp number via Evolution API.
 */
export async function sendWhatsAppMessage(phoneNumber, text, dynamicInstanceName) {
  const evolutionApiUrl = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;
  const activeInstance = dynamicInstanceName || process.env.EVOLUTION_INSTANCE_NAME;

  try {
    const response = await axios.post(
      `${evolutionApiUrl}/message/sendText/${activeInstance}`,
      {
        number: phoneNumber,
        text: text,
        delay: 1500
      },
      {
        headers: {
          'apikey': apiKey,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log(`✅ Message sent to ${phoneNumber} via [${activeInstance}]`);
    return response.data;
  } catch (error) {
    console.error(`❌ Error sending message to ${phoneNumber}:`, error.response?.data || error.message);
  }
}

export async function sendWhatsAppMedia(phoneNumber, base64Image, caption, dynamicInstanceName) {
  const evolutionApiUrl = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;
  const activeInstance = dynamicInstanceName || process.env.EVOLUTION_INSTANCE_NAME;

  try {
    const response = await axios.post(
      `${evolutionApiUrl}/message/sendMedia/${activeInstance}`,
      {
        number: phoneNumber,
        mediatype: 'image',
        media: `data:image/jpeg;base64,${base64Image}`,
        caption
      },
      {
        headers: {
          apikey: apiKey,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log(`✅ Media sent to ${phoneNumber} via [${activeInstance}]`);
    return response.data;
  } catch (error) {
    console.error(`❌ Error sending media to ${phoneNumber}:`, error.response?.data || error.message);
  }
}

export async function forwardMediaToManager(base64Image, captionText, dynamicInstanceName) {
  const managerNumbers = [
    process.env.KITCHEN_MANAGER_NUMBER_1,
    process.env.KITCHEN_MANAGER_NUMBER_2
  ].map(number => number?.trim()).filter(Boolean);

  if (managerNumbers.length === 0) {
    console.error('Failed to send receipt to Kitchen Manager: no manager numbers are configured.');
    return;
  }

  await Promise.all(managerNumbers.map(number =>
    sendWhatsAppMedia(number, base64Image, captionText, dynamicInstanceName)
  ));
}

/**
 * Downloads base64 media from Evolution API using the dynamic instance name.
 */
export async function downloadWhatsAppMedia(messageKey, dynamicInstanceName) {
  const evolutionApiUrl = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;
  const activeInstance = dynamicInstanceName || process.env.EVOLUTION_INSTANCE_NAME;

  if (!evolutionApiUrl || !activeInstance || !apiKey) {
    throw new Error("Evolution API credentials or instance name missing.");
  }

  const endpoint = `${evolutionApiUrl}/chat/getBase64FromMediaMessage/${activeInstance}`;
  
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

  return Buffer.from(base64Data.split(',')[1] || base64Data, 'base64');
}