# BreatheIQ — IoT hardware

Everything needed to build the in-coach sensor node: parts, wiring, pin map, the serial protocol between the Arduino and the ML script, and how the pieces talk to the cloud and the dashboard.

Firmware: [`ardunio code/sketch_jun21a/sketch_jun21a.ino`](ardunio%20code/sketch_jun21a/sketch_jun21a.ino) · ML bridge: [`python code/final.py`](python%20code/final.py)

---

## System overview

```
          ┌──────────── sensors ────────────┐
          │ DHT11   MQ-2   MQ-135   PMS7003 │
          └───┬───────┬──────┬────────┬─────┘
              D8      A0     A1    D11/D12 (SoftwareSerial 9600)
              ▼       ▼      ▼        ▼
          ┌────────────────────────────────────┐   USB serial 115200
          │        Arduino Mega 2560           │ ◄──────────────────► PC · final.py
          │  reads · frames · drives actuators │   a…e  out / t…y in   (4 × Random Forest)
          └──┬──────────┬───────────┬──────────┘                            │
             │ D2–D7    │ D26/D53/D51│ Serial1 (TX1 18 / RX1 19)            ▼
             ▼          ▼           ▼                                   ThingSpeak
         16×2 LCD   Relay board   NodeMCU ESP8266 ──► Wi-Fi                (HTTPS)
                    fan · O₃1 · O₃2
```

---

## Bill of materials

| # | Part | Qty | Purpose |
|---|---|---|---|
| 1 | Arduino Mega 2560 (or compatible) | 1 | Main controller |
| 2 | DHT11 temperature & humidity module | 1 | Cabin temperature (°C) and humidity (%) |
| 3 | MQ-2 gas sensor module (with comparator, DO pin) | 1 | Smoke / LPG / combustible gas |
| 4 | MQ-135 air-quality sensor module (with comparator, DO pin) | 1 | CO₂ / NH₃ / VOC air-quality gases |
| 5 | Plantower PMS7003 laser particle sensor + adapter board | 1 | PM1.0 / PM2.5 / PM10 (µg/m³) |
| 6 | 16×2 character LCD (HD44780) + 10 kΩ potentiometer | 1 | On-board display (contrast pot on V0) |
| 7 | Relay module, 3 channels, active-low, 5 V | 1 | Switches fan and ozone generators |
| 8 | 12 V DC exhaust fan | 1 | Ventilation (head X) |
| 9 | Mini ozone generator module | 2 | Purification (heads Y, Z), gated by the interlock |
| 10 | NodeMCU ESP8266 | 1 | Wi-Fi bridge on Serial1 |
| 11 | Power: 5 V 3 A for logic and sensors, 12 V for fan/ozone | 1 each | Keep the high-current loads off the Arduino's 5 V rail |
| 12 | Jumper wires, breadboard/perfboard, enclosure | — | Mounting in the coach |

---

## Pin map (as in the firmware)

| Device | Device pin | Arduino Mega | Notes |
|---|---|---|---|
| DHT11 | DATA | **D8** | `#define DHTPIN 8`, type DHT11 · VCC 5 V |
| MQ-2 | DO | **A0** | Read with `digitalRead` — **1 = clear, 0 = gas detected** · VCC 5 V |
| MQ-135 | DO | **A1** | Read with `digitalRead` — **1 = clear, 0 = detected** · VCC 5 V |
| PMS7003 | TX | **D11** (SoftwareSerial RX) | 9600 baud, 32-byte frames with checksum |
| PMS7003 | RX | **D12** (SoftwareSerial TX) | PMS logic is 3.3 V — use the adapter board or a level shifter |
| LCD | RS / EN | **D2 / D3** | `LiquidCrystal lcd(2, 3, 4, 5, 6, 7)` |
| LCD | D4 / D5 / D6 / D7 | **D4 / D5 / D6 / D7** | 4-bit mode, RW to GND |
| Relay CH1 | IN | **D26** | Exhaust fan |
| Relay CH2 | IN | **D53** | Ozone generator 1 |
| Relay CH3 | IN | **D51** | Ozone generator 2 |
| ESP8266 | RX | **TX1 (D18)** | `Serial1` at 115200 — Mega is 5 V, ESP is 3.3 V: use a divider on this line |
| PC | USB | USB-B | `Serial` at 115200 |

**Relays are active-low:** `digitalWrite(pin, LOW)` switches a load **on**, `HIGH` switches it **off**. All three start HIGH (off) in `setup()`.

The MQ modules' sensitivity is set with the potentiometer on each board — it moves the threshold at which DO flips to 0. Give MQ sensors a warm-up (ideally a 24-hour burn-in on first use) before trusting them.

---

## Firmware loop

Each pass of `loop()`:

1. Read MQ-2 and MQ-135 (digital), temperature and humidity from the DHT11. If the DHT read fails, print `Failed to read from DHT sensor!` and restart the loop.
2. Read a PMS7003 frame (start byte `0x42`, 32 bytes, checksum verified).
3. Cycle the LCD: `PMS` values → `Temp` / `humidity` → `Gas Val` / `CO2Pin_val` → `PMS` again (1 s each).
4. Send the reading frame on **Serial** (to the PC) and **Serial1** (to the ESP8266).
5. If a prediction line has arrived, show it on the LCD, then act on the **first** abnormal head:

| Priority | Head = 1 | LCD | Relay action |
|---|---|---|---|
| 1 | X (temperature) | `Abnormal Temperature` / `Detected` | Fan **on** |
| 2 | Y (gas) | `Abnormal Gases` / `Detected` | Ozone generator 2 **on** |
| 3 | Z (CO₂) | `CO2 Gas` / `Detected` | Ozone generator 1 **on** |
| 4 | W (dust) | `Dust Particles` / `Detected` | — (display only) |
| — | all 0 | `All are normal` | Fan and both ozone generators **off** |

Relays stay latched until a cycle reports "All are normal".

---

## Serial protocol

### Arduino → PC (one line per loop, 115200 baud)

```
a{temperature}b{gas}c{co2}d{pm}e
```

| Field | Source | Type | Example |
|---|---|---|---|
| `a…` | DHT11 temperature, °C | float, 2 decimals | `26.60` |
| `b…` | MQ-2 digital out | 0 / 1 (1 = clear) | `1` |
| `c…` | MQ-135 digital out | 0 / 1 (1 = clear) | `1` |
| `d…` | PMS7003 `pm10_standard` (PM1.0, standard units) | integer µg/m³ | `3` |

Example: `a26.60b1c1d3e`

### PC → Arduino (after each prediction)

```
t{X}u{Y}v{Z}x{W}y
```

Each value is `0` (normal) or `1` (abnormal), e.g. `t0u0v0x0y` = all normal, `t1u0v1x0y` = hot and CO₂ detected.

### Console output of `final.py`

```
Serial connection opened successfully!

----------------------------
     -= Data Received =-
----------------------------

Data: a26.60b1c1d3e

Temperature: 26.6
Gas: 1
CO2: 1
Pms: 3
Uploading data to webserver....
Data Successfully Uploaded!

Predictions:
X Prediction: 0
Y Prediction: 0
Z Prediction: 0
W Prediction: 0
Temperature is normal
Gases is normal
Air Quality is normal
No Dust particles Detected
t0u0v0x0y
Completed
```

---

## ML bridge (`final.py`)

- Loads `TK172529.xlsx` — columns `Temperature, label_Temperature, Gas, label_Gas, CO2, label_CO2, Pms, label_Pms`.
- Trains four `RandomForestClassifier(random_state=42)` models, one feature each, on an 80/20 split.
- Opens the serial port (`COM5`, 115200 — change to your port), then loops: read frame → upload to ThingSpeak → predict → write `t…y` back.
- ThingSpeak fields: **field1** = Temperature, **field2** = Gas, **field3** = Pms. The write key comes from the `THINGSPEAK_API_KEY` environment variable.

Training data patterns:

| Regime | Temperature | Gas | CO2 | Pms | Labels |
|---|---|---|---|---|---|
| Calm cabin | 25–33 °C | 1 | 1 | 15–60 | all 0 |
| Hot + gases | 34–40 °C | 0 | 0 | 15–60 | T, G, C = 1 · P = 0 |
| Hot + gases + heavy dust | 34–40 °C | 0 | 0 | 100–199 | all 1 |

---

## Connecting the dashboard

The BreatheIQ dashboard can read the Arduino directly, with no Python in between:

1. Close `final.py` (the port can only have one owner).
2. Open the dashboard in **Chrome or Edge** → **System** → **Connect real Arduino** → select the Mega's port.
3. The dashboard parses `a…e` frames at 115200 baud and drives the gauge, tiles, LCD view and model panel from live values.

Values the firmware does not send yet — humidity over serial, PM2.5, PM10, occupancy and ozone concentration — are labelled `SIM` in the UI.

---

## Known limits and next steps

| Today | Next |
|---|---|
| Frame carries only PM1.0 | Add `pm25_standard` and `pm100_standard` to the frame |
| MQ sensors give on/off only | Read the analog outputs for graded gas levels |
| ESP8266 receives frames on Serial1; its bridge sketch is not in this repo | Add the ESP firmware and publish over MQTT (e.g. AWS IoT Core) |
| Ozone relays switch on any gas/CO₂ alarm | Gate them in firmware with an occupancy sensor (PIR/mmWave) and an ozone sensor, matching the dashboard's interlock |
| Classification runs on a PC | Run the model on the cloud or a gateway so the coach needs no laptop |

## Safety

- Ozone is a lung irritant. Run ozone generators **only in unoccupied cabins**, keep exposure under **0.07 ppm (8-hour average, US EPA)**, and ventilate before people return.
- Use a properly rated relay module and a separate supply for the fan and ozone generators; never power them from the Arduino's pins.
- Mains-powered loads must be wired by someone qualified, inside an enclosure.
