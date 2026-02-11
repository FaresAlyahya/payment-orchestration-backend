# API Testing Guide

## 🧪 Testing Your Payment API

This guide will help you test the Payment Orchestration Platform API using various tools.

## Prerequisites

1. Backend server running (http://localhost:3000)
2. PostgreSQL database connected
3. Moyasar test API key configured
4. API key for your test merchant

## Getting Your Test API Key

### Create Test Merchant

Run this SQL query in your PostgreSQL database:

```sql
INSERT INTO merchants (id, name, email, api_key, active, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  'Test Merchant',
  'test@merchant.com',
  'pk_test_1234567890abcdefghijklmnop',
  true,
  NOW(),
  NOW()
);
```

Or use this Node.js script:

```javascript
const crypto = require('crypto');
const apiKey = 'pk_test_' + crypto.randomBytes(20).toString('hex');
console.log('Your test API key:', apiKey);
```

## Testing with cURL

### 1. Health Check

```bash
curl http://localhost:3000/health
```

### 2. Create Payment

```bash
curl -X POST http://localhost:3000/api/v1/payments \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer pk_test_1234567890abcdefghijklmnop" \
  -d '{
    "amount": 100.50,
    "currency": "SAR",
    "description": "Test Payment",
    "source": {
      "type": "creditcard",
      "number": "4111111111111111",
      "name": "Ahmed Ali",
      "month": "12",
      "year": "2025",
      "cvc": "123"
    },
    "metadata": {
      "order_id": "ORDER-123",
      "customer_id": "CUST-456"
    }
  }'
```

### 3. Get Payment Status

```bash
curl http://localhost:3000/api/v1/payments/TRANSACTION_ID \
  -H "Authorization: Bearer pk_test_1234567890abcdefghijklmnop"
```

### 4. Refund Payment

```bash
curl -X POST http://localhost:3000/api/v1/payments/TRANSACTION_ID/refund \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer pk_test_1234567890abcdefghijklmnop" \
  -d '{
    "amount": 50.25,
    "reason": "Customer requested refund"
  }'
```

### 5. List Payments

```bash
curl "http://localhost:3000/api/v1/payments?status=paid&limit=10" \
  -H "Authorization: Bearer pk_test_1234567890abcdefghijklmnop"
```

## Testing with Postman

### Import This Collection

Create a new Postman collection and import these requests:

#### Environment Variables

```json
{
  "base_url": "http://localhost:3000",
  "api_key": "pk_test_1234567890abcdefghijklmnop",
  "transaction_id": ""
}
```

#### Request 1: Create Payment

```
POST {{base_url}}/api/v1/payments
Headers:
  Authorization: Bearer {{api_key}}
  Content-Type: application/json

Body (JSON):
{
  "amount": 100.50,
  "currency": "SAR",
  "description": "Test Payment from Postman",
  "source": {
    "type": "creditcard",
    "number": "4111111111111111",
    "name": "Ahmed Ali",
    "month": "12",
    "year": "2025",
    "cvc": "123"
  }
}

Tests (JavaScript):
if (pm.response.code === 201) {
  const response = pm.response.json();
  pm.environment.set("transaction_id", response.data.id);
}
```

#### Request 2: Get Payment

```
GET {{base_url}}/api/v1/payments/{{transaction_id}}
Headers:
  Authorization: Bearer {{api_key}}
```

## Testing Webhooks Locally

### Using ngrok

1. Install ngrok:
```bash
npm install -g ngrok
```

2. Expose local server:
```bash
ngrok http 3000
```

3. Copy the ngrok URL (e.g., https://abc123.ngrok.io)

4. Configure webhook in Moyasar dashboard:
```
Webhook URL: https://abc123.ngrok.io/api/v1/webhooks/moyasar
```

5. Test webhook with curl:
```bash
curl -X POST http://localhost:3000/api/v1/webhooks/moyasar \
  -H "Content-Type: application/json" \
  -H "X-Moyasar-Signature: test_signature" \
  -d '{
    "type": "payment_paid",
    "data": {
      "id": "moyasar_payment_id",
      "status": "paid",
      "amount": 10050,
      "currency": "SAR"
    },
    "created_at": "2024-02-10T12:00:00Z"
  }'
```

## Moyasar Test Cards

### Successful Payments

| Card Number         | Description          |
|---------------------|----------------------|
| 4111111111111111    | Visa (Success)       |
| 5200000000000007    | Mastercard (Success) |
| 2223000000000007    | Mada (Success)       |

### Failed Payments

| Card Number         | Description          |
|---------------------|----------------------|
| 4000000000000002    | Card Declined        |
| 4000000000000069    | Expired Card         |
| 4000000000000127    | Incorrect CVC        |

**All test cards:**
- CVV: Any 3 digits
- Expiry: Any future date
- Name: Any name

## Expected Response Codes

| Code | Meaning                    |
|------|----------------------------|
| 200  | Success                    |
| 201  | Created (Payment created)  |
| 400  | Bad Request (Validation)   |
| 401  | Unauthorized (Invalid key) |
| 404  | Not Found                  |
| 500  | Server Error               |

## Common Errors & Solutions

### Error: "Invalid API key"

**Solution:** Check your API key is correct and starts with `pk_test_` or `pk_live_`

### Error: "Transaction not found"

**Solution:** Verify the transaction ID exists in your database

### Error: "Database connection failed"

**Solution:** 
```bash
# Check PostgreSQL is running
docker-compose ps

# Restart database
docker-compose restart postgres
```

### Error: "Moyasar API error"

**Solution:** 
- Verify MOYASAR_API_KEY in .env
- Check you're using test cards
- View Moyasar dashboard for more details

## Monitoring Logs

### View Application Logs

```bash
# Development (console)
npm run dev

# Docker logs
docker-compose logs -f api

# Log files
tail -f logs/combined.log
tail -f logs/error.log
```

## Testing Checklist

- [ ] Create payment with valid card
- [ ] Create payment with invalid card
- [ ] Get payment status
- [ ] Refund full amount
- [ ] Refund partial amount
- [ ] List payments with filters
- [ ] Test webhook receiving
- [ ] Test invalid API key
- [ ] Test rate limiting
- [ ] Check logs for errors

## Integration Testing Script

Save this as `test-integration.sh`:

```bash
#!/bin/bash

API_URL="http://localhost:3000/api/v1"
API_KEY="pk_test_1234567890abcdefghijklmnop"

echo "🧪 Running Integration Tests..."

# Test 1: Create Payment
echo "
📝 Test 1: Create Payment"
RESPONSE=$(curl -s -X POST "$API_URL/payments" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 100,
    "currency": "SAR",
    "description": "Integration Test",
    "source": {
      "type": "creditcard",
      "number": "4111111111111111",
      "name": "Test User",
      "month": "12",
      "year": "2025",
      "cvc": "123"
    }
  }')

TRANSACTION_ID=$(echo $RESPONSE | grep -o '"id":"[^"]*' | cut -d'"' -f4)
echo "✅ Payment created: $TRANSACTION_ID"

# Test 2: Get Payment
echo "
📝 Test 2: Get Payment Status"
curl -s "$API_URL/payments/$TRANSACTION_ID" \
  -H "Authorization: Bearer $API_KEY" | jq
echo "✅ Payment retrieved"

# Test 3: List Payments
echo "
📝 Test 3: List Payments"
curl -s "$API_URL/payments?limit=5" \
  -H "Authorization: Bearer $API_KEY" | jq
echo "✅ Payments listed"

echo "
🎉 All tests completed!"
```

Run with:
```bash
chmod +x test-integration.sh
./test-integration.sh
```

---

**Happy Testing! 🚀**
