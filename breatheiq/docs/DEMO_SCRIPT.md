# BreatheIQ: presentation script (1 minute 20 seconds)

Read the **Say** lines aloud while you do the **Do** steps on the live dashboard.

## Before you start (two minutes before)

1. Open **Chrome or Edge**, go to the live dashboard and maximise the window.
   - Across the top you should see the BreatheIQ logo and a menu: **Live · Fleet · Exposure · ML Lab · Controls · System · Playbook**.
   - If you only see a **☰** button at the top right, the window is too narrow: maximise it, or press **Ctrl** and **−** to zoom out.
2. Look at the **top-right corner**. A small rounded label should say **AWS IoT Core · us-east-1 · 0.x s**.
   - If it says **Local engine**, click **Presenter** (top right), switch on **Cloud simulator · coach B2**, press **Esc** and wait about a minute.
3. Next to that label is the **Scenario** box. It should say **1 · Normal**.
   - If it says something else, or a **red banner** runs across the top, press the **1** key and wait a minute or two until the banner disappears. If it is still there after two minutes, press **B**.
4. Click **Live** in the menu, scroll to the very top, then click once on an empty dark part of the page so the keyboard keys work.

## The script

### 0:00 · Live page, very top (the big heading "Breathe easier between stations.")

- **Do:** nothing yet. Look at the judges.
- **Say:** "So here we are at the dashboard of BreatheIQ, built for the Air track: pollution, exposure, and the days the AQI goes off the chart. Train coaches are packed and badly ventilated, and nobody on board knows when the air turns bad."

### 0:13 · Start the bad day

- **Do:** press the **7** key on the number row. The Scenario box at the top right changes to **7 · Everything**. Nothing dramatic happens yet: the air gets worse over the next 30 seconds.
- **Say:** "Let me start a bad day: heat wave, stubble smoke and a packed coach."

### 0:18 · The live link and the AQI

- **Do:** point at the **AWS IoT Core** label in the top-right corner. Then scroll down until you see the card **Air quality index**: a big round gauge with a number in the middle.
- **Say:** "Every two seconds, coach B2 sends its readings to AWS IoT Core. We turn them into India's CPCB AQI, and we don't cap it at 500."

### 0:27 · The model

- **Do:** scroll down a little more. To the right of the gauge, find the card **Random Forest · 4 heads** and click the **Explain** button at its bottom right. A short note, **Why the heads decided this**, opens underneath.
- **Say:** "A Random Forest on AWS Lambda decides what the coach needs, the fan or the purifiers, and Explain shows why."

### 0:34 · The safety interlock

- **Do:** point at the card right next to it, **Actuators · relays**. If an ozone row shows an orange **Blocked** tag, point at that.
- **Say:** "Ozone cleans air but harms people, so our interlock blocks it while the coach is occupied and runs the fans instead."

### 0:42 · Exposure

- **Do:** click **Exposure** in the menu at the top, then point at the cards for each group.
- **Say:** "Same air, different risk: children, the elderly, asthma patients, pregnant passengers and rail staff each get their own dose against WHO and Indian limits."

### 0:51 · Off the chart: the playbook

- **Do:** a **red banner** reading **Off the chart · AQI 5xx** now runs across the top. Click **Open playbook** at the right end of the banner. Scroll down to the green line **On AWS · EventBridge → Step Functions → …**. Under it on the right, the card **Platform announcement · English + Hindi** has two audio players. Click ▶ on the **second** one (under the Hindi text), let it play for two seconds, then click it again to pause.
- **Say:** "And now the AQI is past 500, off the chart. EventBridge starts a Step Functions playbook on AWS. It writes an announcement in English and Hindi, and Amazon Polly reads it out." *(play two seconds)* "SNS alerts the staff, and an incident report is filed when the air recovers."

### 1:10 · Close on the AWS diagram

- **Do:** click **System** in the menu. The AWS diagram opens by itself (tab **Cloud · AWS**).
- **Say:** "All of this runs live on AWS: IoT Core, Lambda, Step Functions, Polly and SNS. BreatheIQ: the most exposed are warned first, and bad-air days finally have a plan. Breathe easier between stations."

## If something goes wrong

- **No red banner yet at 0:51:** talk about Exposure for a few more seconds. If it still hasn't appeared, click **Playbook** in the menu anyway; the **On AWS** part shows the latest run with its audio.
- **Pressing 7 does nothing:** click an empty dark part of the page and press it again, or choose **7 · Everything** in the Scenario box at the top right.
- **The audio doesn't play:** skip it and keep talking.
- **Don't click "Trigger a bad day"** at the top of the Live page: it jumps to the Playbook before the air has turned.

After the presentation, press **1** to bring the coach back to normal.
