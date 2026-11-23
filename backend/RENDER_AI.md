# NestJS and AI service on Render

The public NestJS service remains available at `https://chicken-hospital.onrender.com`. Deploy the AI service as the private service defined in `../ai-service/render.yaml`, in the same Render workspace and `singapore` region.

## NestJS variables on Render

Set these values in the NestJS service:

```text
NODE_ENV=production
PORT=10000
FRONT_ORIGINS=https://chicken-hospital-gamma.vercel.app
GOOGLE_CALLBACK_URL=https://chicken-hospital.onrender.com/auth/google/callback
AI_SERVICE_URL=http://<AI-INTERNAL-HOST>:10000
AI_SERVICE_KEY=<new shared service-to-service secret>
AI_CALLBACK_SECRET=<new shared callback secret, different from AI_SERVICE_KEY>
```

`<AI-INTERNAL-HOST>` is the Internal Address shown by Render for the private AI service. Do not use `localhost:8000` on Render.

## AI service variables on Render

Set these values in the private AI service:

```text
AI_CALLBACK_URL=http://<NEST-INTERNAL-HOST>:10000/internal/ai/result
AI_SERVICE_KEY=<same value as NestJS>
AI_CALLBACK_SECRET=<same value as NestJS>
```

`<NEST-INTERNAL-HOST>` is the NestJS service's Internal Address in Render. Keep both services in the same region. S3 values and Hugging Face model variables also belong on the AI service, as listed in `ai-service/render.yaml`.

## Local development

Run NestJS with `backend/.env` copied from `.env.example`. Run AI with `ai-service/.env` copied from its template. The local endpoints are `http://localhost:4002` and `http://localhost:8000` respectively.

## Required secret rotation

The credentials shown in the shared screenshots must be treated as exposed. Generate and replace the database password, Google/GitHub client secrets, S3 credentials, Redis token, JWT secrets, and both AI secrets before deploying. Update the corresponding third-party dashboards as needed.
