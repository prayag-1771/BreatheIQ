# BreatheIQ: presentation script (about 1:50)

Read aloud while you click through the live dashboard.

**Before you start**

1. Open the Amplify URL in Chrome or Edge on the **Live** page. The pill at the top right should read **AWS IoT Core · us-east-1 · …**. If it reads *Local engine*, press `P` and switch **Cloud simulator** on; frames arrive within a minute.
2. Press `P`, then **Reset**, set speed **×1** and scenario **1**, and close the panel (`Esc`).
3. Keep the staff-alert inbox open on a phone or a second tab.

| Time | Do this | Say this |
|------|---------|----------|
| 0:00 | Live page, top | "So here we are at the dashboard of BreatheIQ, built for the Air track: pollution, exposure, and the days the AQI goes off the chart. Indian train coaches are packed and badly ventilated. The air turns bad between stations, and nobody on board knows." |
| 0:15 | Point at the top-right pill, then scroll to the AQI gauge | "Every two seconds, a reading from coach B2 lands in AWS IoT Core; that's the live link up here. Temperature, gas and dust become an AQI on India's CPCB scale, and we deliberately don't cap it at 500." |
| 0:28 | Point at the four model heads, click **Explain** | "A Random Forest running on AWS Lambda decides what the coach needs: heat switches on the exhaust fan; gas, CO₂ and dust ask for the ozone purifiers. Explain shows the operator why each one fired." |
| 0:42 | Press `7` | "Now let's make a bad day: heat wave, stubble smoke and a packed coach, all at once." |
| 0:47 | Point at the Actuators card | "Watch the safety interlock. Ozone cleans air but harms people, so even when the model asks for it, BreatheIQ refuses while the coach is occupied and falls back to fans and filtration." |
| 0:58 | Open **Exposure** | "Same air, different risk. Children, the elderly, asthma patients, pregnant passengers and rail staff each get their own dose against WHO and Indian limits, with plain advice." |
| 1:10 | Back to **Live** when the red banner appears | "And there it is: AQI past 500, off the chart. Bad Day Mode switches itself on." |
| 1:15 | Open **Playbook**, scroll to *On AWS*; play the Hindi audio for two seconds | "EventBridge starts a Step Functions playbook; this is the real run. It writes the platform announcement in English and Hindi, Amazon Polly reads it out, SNS alerts the staff, and when the air recovers it files an incident report." |
| 1:32 | Press `J`, click **Which coach has the worst air and who is in it?** | "Operators can just ask. Ask BreatheIQ answers straight from the live coach data." |
| 1:40 | **System** → Cloud tab | "All of it runs live on AWS: IoT Core, Lambda, DynamoDB, Step Functions, Polly, SNS, Cognito, Amplify and Amazon Location." |
| 1:48 | Close | "BreatheIQ: the most exposed passengers are warned first, and bad-air days finally have a plan. Breathe easier between stations." |

**Timing:** the red banner appears 20–30 seconds after you press `7` (the coach picks up the scenario, then the air turns), so keep talking on the Exposure page until it shows.

**If something stalls:** press `P`, **Reset**, then `7`, and carry on from 0:42. If the venue Wi-Fi drops, the dashboard keeps running on its local engine and every page still works.

**After the incident closes** (AQI below 250 for 20 s, or press `B` to stand down): Playbook → **Export incident report** opens the report from S3.
