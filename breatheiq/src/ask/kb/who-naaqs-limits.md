# Particulate and ozone limits: WHO 2021 and India NAAQS 2009

Sources: WHO Global Air Quality Guidelines (2021); India National Ambient Air Quality
Standards (NAAQS), CPCB notification of 18 November 2009.

## WHO Air Quality Guidelines 2021

| Pollutant | Averaging time | Guideline |
|---|---|---|
| PM2.5 | Annual | 5 µg/m³ |
| PM2.5 | 24-hour | 15 µg/m³ |
| PM10 | Annual | 15 µg/m³ |
| PM10 | 24-hour | 45 µg/m³ |
| Ozone | 8-hour | 100 µg/m³ |
| Ozone | Peak season | 60 µg/m³ |

## India NAAQS 2009 (industrial, residential, rural and other areas)

| Pollutant | Averaging time | Standard |
|---|---|---|
| PM2.5 | Annual | 40 µg/m³ |
| PM2.5 | 24-hour | 60 µg/m³ |
| PM10 | Annual | 60 µg/m³ |
| PM10 | 24-hour | 100 µg/m³ |
| Ozone | 8-hour | 100 µg/m³ |
| Ozone | 1-hour | 180 µg/m³ |

## How BreatheIQ uses them

BreatheIQ turns the 24-hour PM2.5 limits into a daily dose budget for each passenger group:
budget = limit × 1440 minutes. With the WHO guideline that is 15 × 1440 = 21,600 µg·min/m³ and
with the India NAAQS it is 60 × 1440 = 86,400 µg·min/m³. A passenger's dose grows every minute by
PM2.5 × breathing factor, so the Exposure page can show how much of the daily budget a group has
used and how long remains until the limit at the current rate.
