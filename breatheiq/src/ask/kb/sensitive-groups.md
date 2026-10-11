# Sensitive passenger groups and exposure guidance

Sources: WHO Global Air Quality Guidelines (2021); CPCB National AQI health statements;
BreatheIQ exposure model (`breatheiq/src/sim/exposure.ts`).

BreatheIQ tracks five groups in the instrumented coach. Dose is PM2.5 × minutes × breathing factor,
compared with the WHO and India NAAQS daily budgets.

| Group | Why more exposed | Breathing factor | Warned from AQI |
|---|---|---|---|
| Children under 12 | Breathe faster, lungs still developing | 1.5 | 100 |
| Elderly, 65+ | Heart and lung strain | 1.3 | 100 |
| Asthma / COPD | Existing respiratory illness | 1.7 | 80 |
| Pregnant passengers | Exposure is linked to low birth weight | 1.3 | 100 |
| Rail staff | Whole shifts walking every coach | 1.2 | 150 |

## General guidance BreatheIQ gives (not medical advice)

- Move to the coach with the cleanest air on the rake; the Fleet page and the Bad Day playbook name it.
- Keep windows and doors closed while the train passes a pollution zone or stands at a busy platform.
- Wear a well-fitting mask (N95 or equivalent) if one is available.
- Reduce exertion: stay seated, avoid walking through the worst coaches.
- Rail staff: N95 masks during Bad Day Mode and rounds limited to 20 minutes.
- Anyone who feels unwell should tell train staff. BreatheIQ never diagnoses a condition and never
  recommends medication.
