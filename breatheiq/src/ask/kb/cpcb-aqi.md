# CPCB National Air Quality Index (India)

Source: Central Pollution Control Board (CPCB), National Air Quality Index, 2014.

The Indian AQI is the highest of the pollutant sub-indices. BreatheIQ computes it from the
PM2.5 and PM10 sub-indices measured in the coach (24-hour breakpoints applied to the live reading).
The official scale stops at 500. BreatheIQ deliberately does not cap the value: above 500 the
reading is shown as "off the chart" and Bad Day Mode starts.

## Categories and CPCB health statements

| AQI | Category | CPCB health impact statement |
|---|---|---|
| 0-50 | Good | Minimal impact |
| 51-100 | Satisfactory | Minor breathing discomfort to sensitive people |
| 101-200 | Moderate | Breathing discomfort to people with lung disease, asthma and heart disease |
| 201-300 | Poor | Breathing discomfort to most people on prolonged exposure |
| 301-400 | Very Poor | Respiratory illness on prolonged exposure |
| 401-500 | Severe | Affects healthy people and seriously impacts those with existing diseases |

## Breakpoints used for the sub-indices (24-hour averages, µg/m³)

| Category | PM2.5 | PM10 |
|---|---|---|
| Good | 0-30 | 0-50 |
| Satisfactory | 31-60 | 51-100 |
| Moderate | 61-90 | 101-250 |
| Poor | 91-120 | 251-350 |
| Very Poor | 121-250 | 351-430 |
| Severe | above 250 | above 430 |

Within a band the sub-index is a straight-line interpolation between the band's AQI limits.
Past the top band BreatheIQ keeps extrapolating with the Severe-band slope, so a cabin at
PM2.5 = 450 µg/m³ reads well above 500 instead of being clipped.
