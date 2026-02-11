# Payment Orchestration Platform - Backend API

> A unified payment processing platform for the Saudi market, integrating multiple Payment Service Providers (PSPs) through a single API.

## 🚀 Features

- ✅ **Unified API** - Single API for multiple PSPs
- 💳 **Moyasar Integration** - Fully integrated with Moyasar payment gateway
- 🔄 **Smart Routing** - Intelligent PSP selection based on rules
- 🔒 **Secure** - API key authentication, webhook signature verification
- 🎯 **Webhook Orchestration** - Unified webhook format for all PSPs
- 📊 **Transaction Management** - Complete transaction history and tracking
- 🐳 **Docker Ready** - Containerized and production-ready

## 📋 Prerequisites

- Node.js 20+ 
- PostgreSQL 15+
- Docker & Docker Compose (optional, for containerized deployment)
- Moyasar Account (for testing: https://moyasar.com/)

## ⚙️ Quick Start

### 1. Clone & Install

```bash
cd payment-backend
npm install
```

### 2. Environment Setup

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
# Moyasar Configuration
MOYASAR_API_KEY=your_test_api_key_from_moyasar
MOYASAR_WEBHOOK_SECRET=your_webhook_secret

# Database
DB_PASSWORD=your_secure_password

# JWT
JWT_SECRET=your-super-secret-jwt-key
```

### 3. Database Setup

**Option A: Using Docker Compose (Recommended)**

```bash
docker-compose up -d postgres
```

**Option B: Local PostgreSQL**

```bash
createdb payment_orchestration
```

### 4. Run Development Server

```bash
npm run dev
```

Server will start at `http://localhost:3000`

## 🐳 Docker Deployment

### Full Stack with Docker Compose

```bash
# Start all services (API + PostgreSQL + Redis)
docker-compose up -d

# View logs
docker-compose logs -f api

# Stop all services
docker-compose down
```

### Build Docker Image Only

```bash
docker build -t payment-orchestration-api .
docker run -p 3000:3000 --env-file .env payment-orchestration-api
```

## 📚 API Documentation

### Authentication

All API requests require authentication using API key:

```bash
Authorization: Bearer YOUR_API_KEY
```

### Endpoints

#### 1. Create Payment

```http
POST /api/v1/payments
Content-Type: application/json
Authorization: Bearer YOUR_API_KEY

{
  "amount": 100.50,
  "currency": "SAR",
  "description": "Order #12345",
  "source": {
    "type": "creditcard",
    "number": "4111111111111111",
    "name": "Ahmed Ali",
    "month": "12",
    "year": "2025",
    "cvc": "123"
  },
  "callback_url": "https://your-site.com/payment/callback",
  "metadata": {
    "order_id": "12345",
    "customer_id": "user_123"
  }
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "txn_abc123",
    "status": "paid",
    "amount": 100.50,
    "currency": "SAR",
    "created_at": "2024-02-10T12:00:00Z"
  }
}
```

#### 2. Get Payment Status

```http
GET /api/v1/payments/{transaction_id}
Authorization: Bearer YOUR_API_KEY
```

#### 3. Refund Payment

```http
POST /api/v1/payments/{transaction_id}/refund
Authorization: Bearer YOUR_API_KEY

{
  "amount": 50.25,
  "reason": "Customer requested partial refund"
}
```

#### 4. List Payments

```http
GET /api/v1/payments?status=paid&limit=50&offset=0
Authorization: Bearer YOUR_API_KEY
```

### Webhooks

Configure your webhook URL in merchant settings. All PSP webhooks are standardized to this format:

```json
{
  "event": "payment.paid",
  "transaction_id": "txn_abc123",
  "status": "paid",
  "amount": 100.50,
  "currency": "SAR",
  "created_at": "2024-02-10T12:00:00Z",
  "psp_provider": "moyasar",
  "metadata": {
    "order_id": "12345"
  }
}
```

**Webhook Events:**
- `payment.paid` - Payment successful
- `payment.failed` - Payment failed
- `payment.refunded` - Payment refunded

## 🧪 Testing with Moyasar

### Test Cards

**Successful Payment:**
```
Card: 4111 1111 1111 1111
CVV: Any 3 digits
Expiry: Any future date
```

**Failed Payment:**
```
Card: 4000 0000 0000 0002
CVV: Any 3 digits
Expiry: Any future date
```

**More test cards:** https://docs.moyasar.com/guides/card-payments/test-cards

### Moyasar Sandbox

1. Sign up at https://moyasar.com/
2. Get test API keys from dashboard
3. Use test cards for transactions
4. View transactions in Moyasar dashboard

## 📦 Project Structure

```
payment-backend/
├── src/
│   ├── config/          # Configuration (database, etc.)
│   ├── controllers/     # API request handlers
│   ├── services/        # Business logic
│   ├── models/          # Database models (TypeORM)
│   ├── connectors/      # PSP integrations (Moyasar, etc.)
│   ├── middleware/      # Auth, validation, etc.
│   ├── routes/          # API routes
│   ├── types/           # TypeScript types
│   ├── utils/           # Helper functions
│   └── index.ts         # App entry point
├── logs/                # Application logs
├── Dockerfile           # Docker configuration
├── docker-compose.yml   # Multi-container setup
├── package.json         # Dependencies
├── tsconfig.json        # TypeScript config
└── README.md           # This file
```

## 🔧 Available Scripts

```bash
npm run dev       # Start development server with hot reload
npm run build     # Build TypeScript to JavaScript
npm start         # Start production server
npm test          # Run tests
npm run lint      # Lint code
npm run format    # Format code with Prettier
```

## 🌍 Deployment

### Railway (Recommended for MVP)

1. Install Railway CLI:
```bash
npm install -g @railway/cli
```

2. Login and deploy:
```bash
railway login
railway init
railway up
```

3. Add environment variables in Railway dashboard

### Render

1. Connect your GitHub repo to Render
2. Select "Web Service"
3. Build Command: `npm install && npm run build`
4. Start Command: `npm start`
5. Add environment variables

### Manual VPS Deployment

```bash
# SSH into your server
ssh user@your-server.com

# Clone repo
git clone https://github.com/your-username/payment-backend.git
cd payment-backend

# Install dependencies
npm ci --production

# Build
npm run build

# Use PM2 for process management
npm install -g pm2
pm2 start dist/index.js --name payment-api
pm2 save
pm2 startup
```

## 🔐 Security Best Practices

- ✅ Never commit `.env` file
- ✅ Use strong API keys (32+ characters)
- ✅ Enable webhook signature verification
- ✅ Use HTTPS in production
- ✅ Implement rate limiting (included)
- ✅ Regular security updates
- ✅ Monitor logs for suspicious activity

## 🚧 Roadmap

- [ ] Add HyperPay connector
- [ ] Add Tap Payments connector
- [ ] Implement advanced routing rules UI
- [ ] Add retry logic for failed payments
- [ ] Card tokenization service
- [ ] Admin dashboard API
- [ ] Analytics endpoints
- [ ] Multi-currency support
- [ ] Scheduled refunds
- [ ] Dispute management

## 📞 Support

For issues or questions:
- Email: support@yourcompany.com
- Moyasar Docs: https://docs.moyasar.com/
- GitHub Issues: [Create an issue]

## 📄 License

MIT License - see LICENSE file for details

---

**Built with ❤️ for the Saudi payment ecosystem**
