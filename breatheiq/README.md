# BreatheIQ dashboard

**Breathe easier between stations.** The dashboard for the IoT-10 train-cabin air-quality system (Track 01 · Air): Arduino Mega + DHT11 + MQ-2 + MQ-135 + PMS7003 → Random Forest → exhaust fan and ozone relays, with the pipeline on AWS.

The in-browser engine starts the moment the page opens, so the dashboard always has data and works offline. When `public/aws-config.json` is present (written by `scripts/post-deploy.mjs`), frames come from **AWS IoT Core** instead, and the AWS-backed widgets (Step Functions playbook, Bedrock text, SageMaker model, DynamoDB logs, Amazon Location map, Ask BreatheIQ) light up. If AWS drops, the page carries on locally.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build && npm run preview   # production build, works offline
npx oxlint src     # lint
```

Deploying to AWS is one command from the repository root: see the [main README](../README.md#2-deploy-to-aws).

## Pages

| # | Page | What it shows |
|---|------|---------------|
| 01 | Live | AQI gauge (CPCB, not clamped at 500), sensor tiles, charts, 16×2 LCD emulator, frame console (serial or MQTT), the four ML heads with the serving model and **Explain**, relays and the command frame |
| 02 | Fleet | 12-coach rake coloured by AQI, timetable with haze/tunnel/yard zones, coach drawer, Amazon Location map with route geofences and the train, coach × time heat strip |
| 03 | Exposure | Per-group dose vs WHO / NAAQS, time-to-limit, Bedrock-written advice per group (static advice as fallback), worst-air ranking, journey receipt |
| 04 | ML Lab | Model card (SageMaker job, artifact, registry version), per-head metrics from the training job, **Retrain** on SageMaker, feature relevance, trees, what-if with **Explain**, dataset explorer, replay |
| 05 | Controls | Operator sign-in (Cognito), auto / manual, ozone interlock with its DynamoDB log, decision-boundary editor, alert rules and alerts |
| 06 | System | Cloud tab: live AWS architecture with numbers from CloudWatch and DynamoDB. Hardware tab: pipeline, sensor health, Connect real Arduino, ThingSpeak mirror, standards |
| 07 | Playbook | Bad Day Mode, before/after, auto-actions, and on AWS: the Step Functions execution, EN/HI announcement with Polly audio, SNS message IDs, Bengali translation, the S3 incident report |

Every widget carries a `SENSOR` chip (the prototype measures it) or a `SIM` chip (modelled until the hardware grows), and AWS-backed widgets carry a service chip such as `IoT Core` or `Bedrock`. The header pill shows where frames come from: `AWS IoT Core · us-east-1 · 0.8 s`, `Local engine`, or `Arduino · Web Serial`.

**Ask BreatheIQ** (`J` or the button at the bottom right) streams answers with tool and citation chips, from the Bedrock Agent or the built-in assistant, which uses the same tools and Knowledge Base documents (and also works offline).

## Keyboard

| Key | Action |
|-----|--------|
| `1`–`7` | Scenario: normal · platform rush · heat wave · smoke/gas · haze belt · tunnel dust · everything at once |
| `P` or `⌘K` / `Ctrl+K` | Presenter panel (speed, freeze, reset, hold at peak, cloud simulator on/off, cheat sheet) |
| `Space` | Freeze / resume |
| `B` | Toggle Bad Day Mode |
| `G` | 60-second guided tour |
| `J` | Ask BreatheIQ |
| `Esc` | Close panel / tour / drawer |

Scenarios 5 and 7 push AQI past 500 ("off the chart"); Bad Day Mode then arms itself, in the browser and on AWS.

## Structure

```
src/
  config.ts            product name, train 12302, MQTT topics
  sim/
    core.ts            pure world model: stepWorld(world, inputs) → world (one 2-s tick); also runs in the cloud simulator
    engine.ts          zustand store + timer (speed, pause, persistence) + command mirroring to AWS
    model.ts           the four RF heads, synthetic dataset, metrics, CSV
    explain.ts         two-sentence explanation of the heads (fallback for Bedrock)
    aqi.ts · scenarios.ts · route.ts · geo.ts · exposure.ts
  cloud/               aws-config loader, Cognito credentials, SigV4, AWS IoT source, API client, command mirroring
  ask/                 Ask BreatheIQ assistant, local tools, Knowledge Base documents (also uploaded to S3)
  data/sources.ts      DataSource interface: MockSource, WebSerialSource, ThingSpeakSource
  components/          layout, live widgets, ML, playbook, system, fleet map, Ask drawer, UI primitives
  pages/               one file per page
```

The UI only reads the store. `stepWorld` is pure, so the ML Lab replay and the cloud simulator run the same engine.

## Plug in the real hardware

1. Flash `ardunio code/sketch_jun21a/sketch_jun21a.ino` to the Mega as it is.
2. Close `final.py` (only one program can own the COM port).
3. Open the dashboard in **Chrome or Edge** → System → Hardware → **Connect real Arduino** → pick the port.
4. `WebSerialSource` reads lines at 115200 baud, parses `a{temp}b{gas}c{co2}d{pm}e` and feeds the store. A connected Arduino takes priority over the cloud feed. Humidity, PM2.5, PM10, occupancy and ozone stay modelled (`SIM`).

Next firmware step: add PM2.5 and PM10 to the serial frame (today only `data.pm10_standard`, i.e. PM1.0, is sent).

## Honesty notes

- The coach device on AWS is the cloud simulator for coach B2 (System page → Active device). No reading claims to come from a train in service.
- In the browser, the ML heads are threshold functions with forest-like confidence; on AWS, frames are classified by the real scikit-learn forest trained on `TK172529.xlsx` by SageMaker.
- Generated text is labelled with what produced it.
- Ozone generators are hazardous in occupied spaces (CARB, US EPA). The interlock only allows ozone in an empty cabin under 0.07 ppm.
