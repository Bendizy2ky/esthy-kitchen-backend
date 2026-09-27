export async function generatePaymentLink(amountInNaira, customerPhone, email = "orders@esthyskitchen.com") {
  const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
  
  // This must be the EXACT number your bot uses on Evolution API (e.g., 2349117590168)
  const botWhatsappNumber = process.env.BOT_WHATSAPP_NUMBER || "2349117590168"; 

  if (!paystackSecretKey) {
    console.error('PAYSTACK_SECRET_KEY is missing.');
    return null;
  }

  const amountInKobo = amountInNaira * 100;

  try {
    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${paystackSecretKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: email,
        amount: amountInKobo,
        channels: ['card', 'bank', 'ussd', 'bank_transfer'],
        // Native URI deep-link to force the phone back to the WhatsApp app
        callback_url: `whatsapp://send?phone=${botWhatsappNumber}`,
        metadata: {
          customer_phone: customerPhone
        }
      })
    });

    const data = await response.json();

    if (!data.status) {
      throw new Error(data.message);
    }

    return data.data.authorization_url; 
    
  } catch (error) {
    console.error(`⚠️ Paystack API Error:`, error.message);
    return null;
  }
}