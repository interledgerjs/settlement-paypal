import * as PayPal from 'paypal-rest-sdk'

// API Credentials
const clientId = ''
const clientSecret = ''

// Recipient email
const receiver = ''

async function pay () {
  PayPal.configure({
    mode: 'sandbox',
    client_id: clientId,
    client_secret: clientSecret
  })
  const paymentRequest = {
    sender_batch_header: {
      sender_batch_id: `${Math.random()}`,
      email_subject: 'You have a payout!',
      email_message: 'You have received a payout!'
    },
    items: [
      {
        recipient_type: 'EMAIL',
        amount: {
          value: `${Math.random() * 1000}`,
          currency: 'USD'
        },
        note: 'Thank you!',
        sender_item_id: '201403140001',
        receiver
      }
    ]
  }
  PayPal.payout.create(paymentRequest, (err: PayPal.SDKError, pay: any) => {
    if (pay) {
      console.log('Created PayPal payment for approval:', pay)
    } else {
      console.error('Failed to initiate PayPal payment:', err)
    }
  })
}

pay()
