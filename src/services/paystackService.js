export async function generatePaymentLink(amountInNaira, email = "orders@esthyskitchen.com") {
  const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;

  if (!paystackSecretKey) {
    console.error('PAYSTACK_SECRET_KEY is missing.');
    return null;
  }

  // Paystack processes transactions in kobo (multiply Naira by 100)
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
        // Optional: you can restrict payment channels here if needed
        channels: ['card', 'bank', 'ussd', 'bank_transfer'] 
      })
    });

    const data = await response.json();

    if (!data.status) {
      throw new Error(data.message);
    }

    // Returns the checkout URL (e.g., https://checkout.paystack.com/...)
    return data.data.authorization_url; 
    
  } catch (error) {
    console.error(`⚠️ Paystack API Error:`, error.message);
    return null;
  }
}