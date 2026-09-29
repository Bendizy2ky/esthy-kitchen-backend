// src/services/paystackService.js
export async function generatePaymentLink(amountInNaira, customerPhone, cartData = null, deliveryAddress = "", instanceName = "", email = "orders@esthyskitchen.com") {
  const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
  const botWhatsappNumber = process.env.BOT_WHATSAPP_NUMBER || "2349117590168"; 
  const serverUrl = process.env.SERVER_URL; // e.g., https://esthy-kitchen-backend.onrender.com

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
        // Valid HTTPS redirect back to our server, which will then push them to WhatsApp
        callback_url: `${serverUrl}/payment-success?phone=${botWhatsappNumber}`,
        metadata: {
          customer_phone: customerPhone,
          cart_data: cartData,
          delivery_address: deliveryAddress, // Attached to core metadata
          instance_name: instanceName,
          custom_fields: [
            {
              display_name: "Delivery Address",
              variable_name: "delivery_address",
              value: deliveryAddress || "Not Specified / Extracted from chat"
            }
          ]
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