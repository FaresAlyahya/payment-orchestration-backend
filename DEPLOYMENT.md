# Deployment Guide

## 🚀 Production Deployment Options

This guide covers deploying your Payment Orchestration Platform to production.

---

## Option 1: Railway (Recommended for MVP)

Railway is perfect for MVP deployment - fast, simple, and affordable.

### Prerequisites
- GitHub account
- Railway account (https://railway.app/)

### Steps

1. **Push code to GitHub**
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/your-username/payment-backend.git
git push -u origin main
```

2. **Create Railway Project**
- Go to https://railway.app/
- Click "New Project"
- Select "Deploy from GitHub repo"
- Choose your repository

3. **Add PostgreSQL Database**
- In Railway project dashboard
- Click "New" → "Database" → "PostgreSQL"
- Railway auto-creates connection variables

4. **Configure Environment Variables**

Go to your service settings and add:

```env
NODE_ENV=production
PORT=3000
MOYASAR_API_KEY=pk_live_your_production_key
MOYASAR_WEBHOOK_SECRET=your_webhook_secret
JWT_SECRET=generate-strong-secret-here
ALLOWED_ORIGINS=https://your-frontend.lovable.app,https://yourdomain.com
FRONTEND_URL=https://your-frontend.lovable.app
```

Railway automatically provides:
- `DATABASE_URL` (PostgreSQL connection string)
- `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`

5. **Deploy**

Railway auto-deploys on git push. Your API will be available at:
```
https://your-project.up.railway.app
```

6. **Custom Domain (Optional)**
- Go to Settings → Domains
- Add your custom domain
- Update DNS records as shown

### Cost Estimate
- **Hobby Plan**: $5/month
- **Pro Plan**: $20/month (recommended for production)

---

## Option 2: Render

### Steps

1. **Create Render Account**
- Go to https://render.com/
- Sign up with GitHub

2. **New Web Service**
- Click "New" → "Web Service"
- Connect your GitHub repository
- Configure:
  - **Name**: payment-orchestration-api
  - **Environment**: Node
  - **Build Command**: `npm install && npm run build`
  - **Start Command**: `npm start`
  - **Plan**: Starter ($7/month)

3. **Add PostgreSQL Database**
- Click "New" → "PostgreSQL"
- Name: payment-orchestration-db
- Plan: Starter ($7/month)

4. **Environment Variables**

Add in Render dashboard:

```env
NODE_ENV=production
DATABASE_URL=[Auto-populated by Render]
MOYASAR_API_KEY=pk_live_your_production_key
MOYASAR_WEBHOOK_SECRET=your_webhook_secret
JWT_SECRET=generate-strong-secret-here
ALLOWED_ORIGINS=https://your-frontend.lovable.app
```

5. **Deploy**

Render auto-deploys on push to main branch.

### Cost Estimate
- Web Service: $7/month
- PostgreSQL: $7/month
- **Total**: $14/month

---

## Option 3: DigitalOcean App Platform

### Steps

1. **Create DigitalOcean Account**
- Go to https://www.digitalocean.com/
- Credit card required

2. **Create App**
- App Platform → Create App
- Connect GitHub repository
- Configure:
  - **Name**: payment-api
  - **Region**: Choose closest to Saudi Arabia (Frankfurt or Amsterdam)
  - **Plan**: Basic ($5/month)

3. **Add Database**
- Resources → Add Resource → Database
- Choose PostgreSQL
- Plan: Basic ($12/month)

4. **Environment Variables**

```env
NODE_ENV=production
DATABASE_URL=${db.DATABASE_URL}
MOYASAR_API_KEY=${MOYASAR_API_KEY}
JWT_SECRET=${JWT_SECRET}
```

5. **Deploy**

Click "Deploy" - takes 5-10 minutes.

### Cost Estimate
- App: $5/month
- Database: $12/month
- **Total**: $17/month

---

## Option 4: AWS (Advanced)

For larger scale deployments.

### Architecture

```
Internet → Application Load Balancer 
  → ECS (Docker containers)
  → RDS PostgreSQL
```

### Steps (High-Level)

1. **Create RDS PostgreSQL Instance**
2. **Build & Push Docker Image to ECR**
3. **Create ECS Task Definition**
4. **Deploy to ECS Fargate**
5. **Configure Load Balancer**
6. **Set up Auto-scaling**

**Estimated Cost**: $50-100/month

---

## Post-Deployment Checklist

### 1. Configure Moyasar Webhooks

In Moyasar Dashboard:
```
Webhook URL: https://your-api-domain.com/api/v1/webhooks/moyasar
```

### 2. Test Production API

```bash
# Health check
curl https://your-api-domain.com/health

# Test payment (use test API key first!)
curl -X POST https://your-api-domain.com/api/v1/payments \
  -H "Authorization: Bearer pk_test_..." \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 1,
    "currency": "SAR",
    "description": "Production test"
  }'
```

### 3. Create Production Merchant

```sql
-- Connect to production database
INSERT INTO merchants (id, name, email, api_key, active, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  'Your Company Name',
  'admin@yourcompany.com',
  'pk_live_' || encode(gen_random_bytes(32), 'hex'),
  true,
  NOW(),
  NOW()
);

-- Get your API key
SELECT api_key FROM merchants WHERE email = 'admin@yourcompany.com';
```

### 4. Update Frontend

In your Lovable dashboard, update API endpoint:

```javascript
const API_BASE_URL = 'https://your-api-domain.com/api/v1';
```

### 5. Set Up Monitoring

**Railway:**
- Built-in metrics in dashboard
- Set up alerts for errors

**Render:**
- Logs available in dashboard
- Integrate with Sentry for error tracking

**Recommended Tools:**
- **Sentry** (error tracking): https://sentry.io/
- **Logtail** (log management): https://logtail.com/
- **UptimeRobot** (uptime monitoring): https://uptimerobot.com/

---

## Security Hardening

### 1. HTTPS Only

Ensure your deployment platform enforces HTTPS.

### 2. Environment Variables

Never commit these to git:
- API keys
- Database passwords
- JWT secrets
- Webhook secrets

### 3. Rate Limiting

Already configured in code (100 requests/15 min).

For production, consider:
- Cloudflare (free DDoS protection)
- AWS WAF
- Nginx rate limiting

### 4. Database Backups

**Railway:** Automatic backups included

**Render:** Configure in dashboard

**Manual:**
```bash
# Backup
pg_dump $DATABASE_URL > backup.sql

# Restore
psql $DATABASE_URL < backup.sql
```

### 5. API Key Rotation

Implement regular API key rotation:

```sql
-- Rotate merchant API key
UPDATE merchants 
SET api_key = 'pk_live_' || encode(gen_random_bytes(32), 'hex'),
    updated_at = NOW()
WHERE email = 'merchant@email.com';
```

---

## Scaling Considerations

### When to Scale

Monitor these metrics:
- Response time > 500ms
- CPU > 70%
- Memory > 80%
- Database connections > 80%

### Horizontal Scaling

**Railway/Render:**
- Upgrade to higher plan
- Add replicas in dashboard

**Self-hosted:**
```bash
# Docker Swarm
docker swarm init
docker service scale payment-api=3

# Kubernetes
kubectl scale deployment payment-api --replicas=3
```

### Database Scaling

1. **Connection Pooling** (already configured with TypeORM)
2. **Read Replicas** for analytics
3. **Caching** with Redis

---

## Troubleshooting

### Issue: "Database connection failed"

**Check:**
```bash
# Test connection
psql $DATABASE_URL

# View logs
railway logs
# or
render logs
```

### Issue: "Moyasar API errors"

**Verify:**
- Using production API key (`pk_live_...`)
- Webhook URL is publicly accessible
- HTTPS is enabled

### Issue: "High memory usage"

**Solutions:**
- Limit database connection pool
- Add Redis caching
- Upgrade to higher plan

---

## Production Monitoring Setup

### 1. Install Sentry (Error Tracking)

```bash
npm install @sentry/node
```

Add to `src/index.ts`:

```typescript
import * as Sentry from '@sentry/node';

if (process.env.NODE_ENV === 'production') {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: 'production'
  });
}
```

### 2. Health Checks

Your API includes a `/health` endpoint. Configure uptime monitoring:

**UptimeRobot:**
- URL: `https://your-api.com/health`
- Interval: Every 5 minutes
- Alert: Email when down

---

## Cost Comparison Summary

| Platform         | Monthly Cost | Best For                    |
|------------------|--------------|-----------------------------|
| Railway          | $5-20        | MVP, Easy deployment        |
| Render           | $14          | Balanced price/features     |
| DigitalOcean     | $17          | More control                |
| AWS              | $50-100      | Enterprise, High scale      |

---

## Support & Next Steps

1. ✅ Deploy to production platform
2. ✅ Configure Moyasar webhooks
3. ✅ Test with real transactions
4. ✅ Set up monitoring
5. ✅ Update frontend to use production API
6. 🚀 Go live!

**Need help?** 
- Railway: https://railway.app/help
- Render: https://render.com/docs
- Moyasar: https://help.moyasar.com/

---

**Good luck with your deployment! 🎉**
