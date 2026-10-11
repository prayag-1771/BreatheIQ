# BreatheIQ on AWS

Every AWS service BreatheIQ uses, what it does here, and where to find it in the code. The whole stack is AWS CDK (TypeScript) in [`infra/`](infra/); one command deploys it and one removes it (see [README](README.md#deploy-to-aws)).

```
 EventBridge Scheduler (every minute)
        │
        ▼
 Lambda device-simulator ── MQTT breatheiq/12302/B2/telemetry ──► AWS IoT Core
   (coach B2, one frame every 2 s)                                   │ IoT Rule
                                                                     ▼
          ┌──────────────────────────────────────────── Lambda process-frame
          │                                              │  AQI · ozone interlock · alert rules
          ▼                                              ├──► Lambda rf-inference (SageMaker-trained forest, as decision trees)
   IoT Core breatheiq/12302/B2/command  ◄────────────────┤
   (t…y command + relay states)                          ├──► DynamoDB (Telemetry, CoachState, Incidents, InterlockLog, Alerts)
          │                                              ├──► Amazon Location tracker ─► geofence ENTER ─► pre-emptive ventilation
          │                                              └──► EventBridge  AqiOffTheChart · OzoneBlocked · RuleFired · IncidentClosed
          │                                                           │
          │                                                           ▼
          │                                     Step Functions  breatheiq-bad-day-playbook
          │                     Bedrock (EN + HI announcement, SMS, staff note) → Polly (MP3 → S3) → SNS (email, SMS)
          │                     → Translate (Bengali) → DynamoDB incident → wait for recovery → Bedrock incident report → S3
          ▼
 Dashboard on Amplify Hosting ◄── MQTT over WebSocket (Cognito guest credentials, subscribe-only)
   │  API Gateway HTTP API (IAM auth) → Lambda api → DynamoDB · Step Functions · SageMaker · S3 · CloudWatch
   └─ Ask BreatheIQ ── Lambda Function URL (streaming) → Bedrock Agent + Knowledge Base (S3 Vectors) + Guardrails
```

## Services

| # | Service | Job in BreatheIQ | Code |
|---|---|---|---|
| 1 | **AWS IoT Core** | A thing per coach (12), an X.509 certificate for coach B2 (private key kept as an SSM SecureString, never on disk), the `breatheiq-coach-device` IoT policy, telemetry and command topics, and the IoT Rule `breatheiq_telemetry` that hands every frame to `process-frame`. Replaces ThingSpeak as the device backbone. | `infra/lib/core-stack.ts`, `scripts/post-deploy.mjs` |
| 2 | **AWS Lambda** | `device-simulator`, `process-frame`, `rf-inference`, `api`, `chat` (response streaming), `playbook` (Step Functions tasks), `agent-actions` (Bedrock Agent action group), `geofence`. Node.js 22 on Arm, least-privilege role each. | `infra/lambda/` |
| 3 | **Amazon SageMaker AI** | A scikit-learn script-mode training job trains the four Random-Forest heads exactly as `final.py` does (one feature each, 80/20 split, `random_state=42`) on `TK172529.xlsx`, writes `model.tar.gz` and `metrics.json` to S3, and registers each model in the Model Registry group `breatheiq-rf`. The job also exports the forests as plain decision trees (`forest.json`), which `rf-inference` serves with exactly scikit-learn's predictions. No always-on endpoint. **ML Lab → Retrain model** starts a real job. | `infra/training/train.py`, `infra/lambda/rf-inference.ts` |
| 4 | **Amazon S3** | Training data and script, model artifacts, Knowledge Base documents, Polly audio (30-day expiry), incident reports. Private, encrypted, TLS-only. | `infra/lib/core-stack.ts` |
| 5 | **Amazon DynamoDB** | On-demand tables: `Telemetry` (24-hour TTL), `CoachState` (latest frame, controls, cached advice, last Bedrock call), `Incidents`, `InterlockLog`, `Alerts`. | `infra/lambda/process-frame.ts` |
| 6 | **Amazon EventBridge** | Custom bus `breatheiq` with `AqiOffTheChart`, `OzoneBlocked`, `RuleFired`, `IncidentClosed`, `GeofenceEntered/Exited`. EventBridge Scheduler runs the simulator once a minute. A rule starts the playbook on `AqiOffTheChart`. | `infra/lib/core-stack.ts` |
| 7 | **AWS Step Functions** | `breatheiq-bad-day-playbook`: announce → speak → notify → translate → save → wait/check until the air recovers → report. The Playbook page shows the real execution history. | `infra/lib/core-stack.ts`, `infra/lambda/playbook.ts` |
| 8 | **Amazon Bedrock** | Converse API for four generations: the Bad Day announcer (strict JSON via tool use: EN + HI announcement ≤ 60 words, one SMS per group ≤ 300 chars, a staff instruction), per-group exposure advice (cached in DynamoDB per group + risk + cleanest coach), "Explain this decision", and the incident report. Model IDs live in SSM, never in code. | `infra/lambda/bedrock.ts`, `playbook.ts`, `api.ts` |
| 9 | **Bedrock Agents** | "Ask BreatheIQ": an agent with the `coach-operations` action group — `getCoachStatus`, `getWorstCoaches`, `getInterlockLog`, `getExposure`, `getIncident`, `setScenario` (operator only). | `infra/lib/bedrock-stack.ts`, `infra/lambda/agent-actions.ts`, `tools.ts` |
| 10 | **Bedrock Knowledge Bases** | RAG over the hardware notes, README, CPCB AQI, WHO 2021 / India NAAQS limits, EPA/CARB ozone guidance, sensor datasheet summaries, sensitive-group guidance and the playbook. Vector store: **Amazon S3 Vectors** (no always-on vector database). Embeddings: Titan Text Embeddings V2. | `breatheiq/src/ask/kb/`, `infra/lib/bedrock-stack.ts` |
| 11 | **Bedrock Guardrails** | `breatheiq-passenger-safety` on every passenger-facing generation and `breatheiq-ask-grounded` on the agent: denied topics (diagnosis, medication, unrelated requests), content filters, prompt-attack filter, PII anonymisation, and a contextual grounding check on Knowledge Base answers. | `infra/lib/bedrock-stack.ts` |
| 12 | **Amazon Polly** | Neural voice Kajal reads the announcement in English (en-IN) and Hindi (hi-IN); MP3s go to S3 and play on the Playbook page. | `infra/lambda/playbook.ts` |
| 13 | **Amazon Translate** | Adds the advisory in Bengali (SSM flag `/breatheiq/flags/extra-language`). | `infra/lambda/playbook.ts` |
| 14 | **Amazon SNS** | `breatheiq-staff-alerts` topic (email) for staff and alarms; direct SMS to verified numbers listed in the SSM SecureString `/breatheiq/sms/numbers`. | `infra/lambda/playbook.ts` |
| 15 | **Amazon API Gateway** | HTTP API with IAM auth: state, history, incidents (with presigned audio and report URLs), interlock log, alerts, controls, model and training status, playbook history, metrics, location, explain, advice. Throttled at 20 req/s. | `infra/lambda/api.ts` |
| 16 | **Amazon Cognito** | Identity pool: guest role (subscribe to the coach topics, call the API and the chat URL) and operator role. User pool with one `operator` user, whose sign-in unlocks the Controls settings and `setScenario`. | `infra/lib/core-stack.ts`, `breatheiq/src/cloud/auth.ts` |
| 17 | **AWS Amplify Hosting** | Hosts the built dashboard (manual deployments from `scripts/publish-web.mjs`, so no GitHub authorisation is needed). | `infra/lib/web-stack.ts` |
| 18 | **Amazon CloudWatch** | Logs (one-week retention), metric filters for Bedrock calls (requests, answered, latency, tokens), the `breatheiq` dashboard, and alarms: frame-processor errors, slow inference, failed playbook, silent telemetry. | `infra/lib/web-stack.ts` |
| 19 | **AWS Systems Manager Parameter Store** | Model IDs, guardrail/agent/KB IDs, the current model pointer, feature flags, SMS numbers (SecureString), the operator password (SecureString), the device certificate and key (SecureString). | everywhere |
| 20 | **Amazon Location Service** | Tracker `breatheiq-train` (position once a minute) linked to the geofence collection `breatheiq-route` (crop-burning belt, tunnel, two yards). ENTER events arrive on EventBridge and switch on ventilation before the cabin air turns. The Fleet page draws the route on an Amazon Location map. | `infra/lambda/geofence.ts`, `breatheiq/src/components/fleet/` |
| 21 | **AWS Budgets** | `breatheiq-monthly` (USD 20): alerts at 50 %, 100 % and forecast 100 % to the staff topic, counted before credits. | `infra/lib/web-stack.ts` |

## Why the model is served as decision trees

The training job writes the four fitted forests twice: as `model.joblib` and as plain decision trees in `forest.json`. `rf-inference` walks those trees exactly as scikit-learn does (float32 input, `x <= threshold`, class-1 shares averaged over 100 trees), so it needs no scikit-learn container: deploys need no Docker and cold starts take milliseconds. Checked against scikit-learn on 4,704 inputs: identical predictions and probabilities.

## Data in the cloud

The coach device is the **cloud simulator for coach B2**: a Lambda running the same pure engine as the dashboard (`breatheiq/src/sim/core.ts`). It publishes a frame every 2 s in the firmware's format (`a{temp}b{gas}c{co2}d{pm}e`) plus humidity, PM2.5, PM10, occupancy and ozone. The real ESP8266 can publish to the same topic with the certificate in SSM. The dashboard starts its own engine immediately and hands over to IoT Core when frames arrive; if AWS drops, it carries on locally without a gap.

## Written fallbacks

Every Bedrock call goes through `infra/lambda/bedrock.ts`, which never throws, and every generation has a written fallback so a tick never waits on a model:

- announcements, SMS and the staff note have bilingual templates within the same limits;
- advice has the static text in `breatheiq/src/sim/exposure.ts`;
- "Explain" has a two-sentence explanation computed from the votes;
- incident reports have a templated report;
- Ask BreatheIQ has a built-in assistant (`breatheiq/src/ask/assistant.ts`) that uses the same tools and Knowledge Base documents and cites them.

The UI labels each piece of text with what produced it, and the System → Cloud tab shows the latest Bedrock call's latency and tokens.

## Security

- No secrets, keys, phone numbers or account IDs in git. `breatheiq/public/aws-config.json` (endpoints, pool IDs, map key) and `infra/cdk-outputs.json` are generated and ignored.
- Least-privilege IAM per Lambda; the guest role can only connect as `breatheiq-web-*`, subscribe to `breatheiq/12302/*`, invoke the API and the chat URL.
- Controls changes and `setScenario` from the agent need the operator role (checked server side).
- The ozone interlock runs in the cloud as well: ozone only in an unoccupied cabin with estimated ozone under 0.07 ppm (8-hour).

## Cost (us-east-1, monthly)

| Item | Simulator running 24/7 | Simulator paused |
|---|---|---|
| IoT Core (≈ 2.6 M messages, 1.3 M rule actions) | ≈ $3 | $0 |
| Lambda (simulator 128 MB; processor; inference) | ≈ $2–3 | $0 |
| DynamoDB on-demand (≈ 8 M writes) | ≈ $6 | < $0.10 |
| Amazon Location (one position a minute + geofence checks) | ≈ $4 | $0 |
| CloudWatch (logs, 4 alarms, dashboard, custom metrics) | ≈ $1–2 | ≈ $1 |
| S3, Amplify, SSM, Cognito, Scheduler, EventBridge | < $1 | < $1 |
| Step Functions, Polly, Translate, SNS email (per incident) | cents | $0 |
| Bedrock (per incident and question) | cents | $0 |
| SageMaker training (per **Retrain**, ml.m5.large, ~2 min) | < $0.01 per run | $0 |
| **Total** | **≈ $17–20** | **≈ $1–2** |

Nothing has a fixed hourly price: no SageMaker endpoint, no OpenSearch Serverless, no NAT gateway. Pause the simulator from the Presenter panel (`P`) when not presenting.
