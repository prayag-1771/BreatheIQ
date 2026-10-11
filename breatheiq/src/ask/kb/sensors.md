# Sensors in the BreatheIQ coach node

Sources: manufacturer datasheets (Aosong DHT11, Hanwei MQ-2 and MQ-135, Plantower PMS7003).

| Sensor | Measures | Typical range and accuracy | Notes |
|---|---|---|---|
| DHT11 | Temperature, relative humidity | 0-50 °C ±2 °C; 20-90 % RH ±5 % | One reading per second at most. Drives head X (exhaust fan). |
| MQ-2 | Combustible gas and smoke (LPG, propane, hydrogen, methane, smoke) | about 300-10,000 ppm | Heated tin-dioxide element, needs warm-up. BreatheIQ reads the digital comparator output: 1 = clear, 0 = gas detected. Drives head Y. |
| MQ-135 | Air-quality gases (ammonia, NOx, alcohol, benzene, smoke, CO₂) | about 10-1,000 ppm | Not selective for CO₂; used as a general "stale air" detector. Digital output: 1 = clear, 0 = detected. Drives head Z. |
| PMS7003 | Particulate matter PM1.0, PM2.5, PM10 | 0-500 µg/m³ effective range, 1 µg/m³ resolution, particles from 0.3 µm | Laser scattering with a fan. Serial frames at 9600 baud. Drives head W. |

## Known limits of the prototype

- The firmware forwards PM1.0 only in its serial frame (`d` field); PM2.5 and PM10 are derived
  from it until the frame is extended.
- MQ sensors drift with temperature and humidity and are read as on/off signals, so they
  indicate presence, not concentration.
- There is no occupancy sensor yet; occupancy is an input to the interlock that comes from the
  coach simulator or the operator's "cabin unoccupied" switch.
