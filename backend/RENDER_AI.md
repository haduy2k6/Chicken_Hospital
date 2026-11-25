# NestJS and AI service on Render

The public NestJS service remains available at `https://chicken-hospital.onrender.com`. Deploy the AI service as the private service defined in `../ai-service/render.yaml`, in the same Render workspace and `singapore` region.

## NestJS variables on Render

Set these values in the NestJS service:

```text
NODE_ENV=production
PORT=10000
FRONT=https://chicken-hospital-gamma.vercel.app
GOOGLE_CALLBACK_URL=https://chicken-hospital-gamma.vercel.app/api/auth/google/callback
AI_SERVICE_URL=http://<AI-INTERNAL-HOST>:10000
AI_SERVICE_KEY=<new shared service-to-service secret>
AI_CALLBACK_SECRET=<new shared callback secret, different from AI_SERVICE_KEY>
```

Optional backpressure on NestJS (defaults shown; tune together with the AI service below):

```text
AI_SUBMIT_TIMEOUT_MS=12000
AI_DISPATCH_PACING_MS=8000
AI_DISPATCH_BATCH_PER_RUN=5
AI_RESUBMIT_COOLDOWN_MS=600000
AI_MAX_RETRY=2
AI_FAIL_AFTER_MS=2700000
AI_CIRCUIT_BASE_OPEN_MS=60000
AI_CIRCUIT_MAX_OPEN_MS=600000
AI_HEALTH_TIMEOUT_MS=10000
AI_DISPATCH_LOCK_TTL_SEC=300
```

`<AI-INTERNAL-HOST>` is the Internal Address shown by Render for the private AI service. Do not use `localhost:8000` on Render.

Google OAuth uses the proxy flow: the browser opens `/api/auth/google` on the Vercel site, Google returns to
`GOOGLE_CALLBACK_URL` on that same site, and Next.js rewrites `/api/*` to this service via `BACKEND_URL`.
Register the same Vercel callback URL in Google Cloud Console. Cookies are `sameSite=lax`.

## AI service variables on Render

Set these values in the private AI service:

```text
AI_CALLBACK_URL=http://<NEST-INTERNAL-HOST>:10000/internal/ai/result
AI_SERVICE_KEY=<same value as NestJS>
AI_CALLBACK_SECRET=<same value as NestJS>
```

`<NEST-INTERNAL-HOST>` is the NestJS service's Internal Address in Render (a public origin also works). Keep both services in the same region. Do not add a trailing slash after `/result`. `AI_CALLBACK_URL` belongs on the **AI service**; NestJS only reads `AI_SERVICE_URL`, `AI_SERVICE_KEY` and `AI_CALLBACK_SECRET`. S3 values and Hugging Face model variables also belong on the AI service, as listed in `ai-service/render.yaml`.

## Local development

Run NestJS with `backend/.env` copied from `.env.example`. Run AI with `ai-service/.env` copied from its template. The local endpoints are `http://localhost:4002` and `http://localhost:8000` respectively.

## Required secret rotation

The credentials shown in the shared screenshots must be treated as exposed. Generate and replace the database password, Google/GitHub client secrets, S3 credentials, Redis token, JWT secrets, and both AI secrets before deploying. Update the corresponding third-party dashboards as needed.
