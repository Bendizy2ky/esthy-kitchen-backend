import dotenv from 'dotenv';
dotenv.config();

async function createWhatsAppInstance() {
  const url = `${process.env.EVOLUTION_API_URL}/instance/create`;
  const apiKey = process.env.EVOLUTION_API_KEY;
  const instanceName = process.env.EVOLUTION_INSTANCE_NAME || 'EsthyKitchen';

  console.log(`🚀 Creating instance "${instanceName}" at ${process.env.EVOLUTION_API_URL}...`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        instanceName: instanceName,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS'
      })
    });

    const data = await response.json();
    console.log('✅ Response:', JSON.stringify(data, null, 2));

    const qrBase64 = data?.qrcode?.base64 || data?.base64;
    if (qrBase64) {
      console.log('\n📸 Copy and paste this string into your browser address bar to view the QR code:\n');
      console.log(qrBase64);
    }
  } catch (error) {
    console.error('❌ Failed to create instance:', error.message);
  }
}

createWhatsAppInstance();