# Bad Day playbook

Source: BreatheIQ operating design (`AWS.md`, `breatheiq/src/sim/core.ts`, `infra/lambda/playbook.ts`).

Bad Day Mode starts automatically when cabin AQI goes above 500 (off the CPCB chart), or when the
operator switches it on. One incident is opened per excursion and closed when AQI has stayed
below 250 for 20 seconds (automatic incidents) or when the operator switches the mode off.

## What happens, in order

1. **Detect** - the frame processor sees AQI > 500 and publishes an `AqiOffTheChart` event.
2. **Ventilation boost** - exhaust fan to 2,400 rpm, dampers to recirculate and filter.
3. **Ozone interlock** - an ozone request in an occupied cabin is blocked; fan and filtration run instead.
4. **Announcement** - a platform announcement is written in English and Hindi (60 words or fewer each)
   and rendered to speech.
5. **Advisories** - one short SMS advisory per sensitive group, and an instruction for staff.
6. **Regional language** - the advisory is translated into one more regional language.
7. **Re-allocation** - sensitive passengers are advised to move from the worst coach to the cleanest coach.
8. **Record** - the incident, its messages and audio are saved.
9. **Report** - when the incident closes, a narrative incident report is written with the timeline,
   peak AQI, actions taken and what to improve.

The state machine that runs these steps is `breatheiq-bad-day-playbook` in AWS Step Functions.
