#include <SoftwareSerial.h>
SoftwareSerial pmsSerial(11, 12);
#include <LiquidCrystal.h>
#include <DHT.h>

#define DHTPIN 8        // DHT11 data pin connected to D2
#define DHTTYPE DHT11
DHT dht(DHTPIN, DHTTYPE);

const int rs = 2, en = 3, d4 = 4, d5 = 5, d6 = 6, d7 = 7;
LiquidCrystal lcd(rs, en, d4, d5, d6, d7);

int Ozone_gen1 = 53;
int Ozone_gen2 = 51;
int Fan = 26;

int GasPin = A0;
int CO2Pin = A1;
int GasPin_val;
int CO2Pin_val;
void setup() {
  // our debugging output
  Serial.begin(115200);
  Serial1.begin(115200);

  dht.begin();

  pinMode(GasPin, INPUT);
  pinMode(CO2Pin, INPUT);
  pinMode(Fan, OUTPUT);
  pinMode(Ozone_gen2, OUTPUT);
  pinMode(Ozone_gen1, OUTPUT);
  // sensor baud rate is 9600
  pmsSerial.begin(9600);

  digitalWrite(Ozone_gen1, HIGH);
  digitalWrite(Ozone_gen2, HIGH);
  digitalWrite(Fan, HIGH);
  lcd.begin(16, 2);
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("AIR QUALITY ");
  lcd.setCursor(0, 1);
  lcd.print(" Monitoring in Train");
  delay(1000);
}

struct pms5003data {

  uint16_t framelen;
  uint16_t pm10_standard, pm25_standard, pm100_standard;
  uint16_t pm10_env, pm25_env, pm100_env;
  uint16_t particles_03um, particles_05um, particles_10um, particles_25um, particles_50um, particles_100um;
  uint16_t unused;
  uint16_t checksum;
};

struct pms5003data data;

void loop() {


  GasPin_val = digitalRead(GasPin);
  CO2Pin_val = digitalRead(CO2Pin);
  float temperature = dht.readTemperature();
  float humidity = dht.readHumidity();

  if (isnan(temperature) || isnan(humidity)) {
    Serial.println("Failed to read from DHT sensor!");
    return;
  }
  if (readPMSdata(&pmsSerial)) {
    // reading data was successful!
    //    Serial.println();
    //    Serial.println("---------------------------------------");
    //    Serial.println("Concentration Units (standard)");
    //    Serial.print("PM 1.0: "); Serial.print(data.pm10_standard);
    //    Serial.print("\t\tPM 2.5: "); Serial.print(data.pm25_standard);
    //    Serial.print("\t\tPM 10: "); Serial.println(data.pm100_standard);
    //    Serial.println("---------------------------------------");
    //    Serial.println("Concentration Units (environmental)");
    //    Serial.print("PM 1.0: "); Serial.print(data.pm10_env);
    //    Serial.print("\t\tPM 2.5: "); Serial.print(data.pm25_env);
    //    Serial.print("\t\tPM 10: "); Serial.println(data.pm100_env);
    //    Serial.println("---------------------------------------");
    //    Serial.print("Particles > 0.3um / 0.1L air:"); Serial.println(data.particles_03um);
    //    Serial.print("Particles > 0.5um / 0.1L air:"); Serial.println(data.particles_05um);
    //    Serial.print("Particles > 1.0um / 0.1L air:"); Serial.println(data.particles_10um);
    //    Serial.print("Particles > 2.5um / 0.1L air:"); Serial.println(data.particles_25um);
    //    Serial.print("Particles > 5.0um / 0.1L air:"); Serial.println(data.particles_50um);
    //    Serial.print("Particles > 10.0 um / 0.1L air:"); Serial.println(data.particles_100um);
    //    Serial.println("---------------------------------------");
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("PMS ");
    lcd.print(data.pm10_standard);
    lcd.setCursor(0, 1);
    lcd.print("PMS 2.5");
    lcd.print(data.pm25_env);
    delay(1000);
  }

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Temp:  ");
  lcd.print(temperature);
  lcd.setCursor(0, 1);
  lcd.print("humidity  ");
  lcd.print(humidity);
  delay(1000);
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Gas Val ");
  lcd.print(GasPin_val);
  lcd.setCursor(0, 1);
  lcd.print("CO2Pin_val ");
  lcd.print(CO2Pin_val);
  delay(1000);
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("PMS ");
  lcd.print(data.pm10_standard);
  lcd.setCursor(0, 1);
  lcd.print("PMS 2.5");
  lcd.print(data.pm25_env);
  delay(1000);


  String readings = (String("a") + String(temperature) + String("b") + String(GasPin_val) + String("c") + String(CO2Pin_val) + String("d") + String(data.pm10_standard) + String("e"));
  Serial.println (readings);
  Serial1.println (readings);


  delay(2000);



  String data1 = "";
  if (Serial.available() > 0) {
    String data = Serial.readStringUntil('\n');
    Serial.println(data);

    int indexA = data.indexOf("t") + 1;
    int indexB = data.indexOf("u") + 1;
    int indexC = data.indexOf("v") + 1;
    int indexD = data.indexOf("x") + 1;
    int indexE = data.indexOf("y") + 1;
    delay(500);
    String valueA = data.substring(indexA, indexB - 1);
    String valueB = data.substring(indexB, indexC - 1);
    String valueC = data.substring(indexC, indexD - 1);
    String valueD = data.substring(indexD, indexE - 1);
    String valueE = data.substring(indexE); // Assuming it goes to the end of the string

    delay(500);

    //  Serial.println("Value a: " + valueA);
    //  Serial.println("Value b: " + valueB);
    //  Serial.println("Value c: " + valueC);
    //  Serial.println("Value d: " + valueD);
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("a");
    lcd.print(valueA);
    lcd.print("b");
    lcd.print(valueB);
    lcd.setCursor(0, 1);
    lcd.print("c");
    lcd.print(valueC);
    lcd.print("d");
    lcd.print(valueD);


    delay(3000);

    if (valueA == "1") {
      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("Abnormal Temperature ");
      lcd.setCursor(0, 1);
      lcd.print("Detected");
      digitalWrite(Fan, LOW);
      lcd.setCursor(0, 1);
      //      lcd.print("Good:-)");

      delay(5000);

    }
    else if (valueB == "1") {
      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("Abnormal Gases");
      lcd.setCursor(0, 1);
      lcd.print("Detected");
      digitalWrite(Ozone_gen2, LOW);
      delay(5000);

    }


    else if (valueC == "1") {
      lcd.clear();
      lcd.print("CO2 Gas");
      lcd.setCursor(0, 1);
      lcd.print("Detected");
      digitalWrite(Ozone_gen1, LOW);
      delay(2000);

    }

    else if (valueD == "1") {
      lcd.clear();
      lcd.print("Dust Particles ");
      lcd.setCursor(0, 1);
      lcd.print("Detected");
      delay(2000);

    }

    else  {
      lcd.clear();
      lcd.print("All are normal ");
      lcd.setCursor(0, 1);
      lcd.print("");
      digitalWrite(Ozone_gen1, HIGH);
      digitalWrite(Ozone_gen2, HIGH);
      digitalWrite(Fan, HIGH);

      delay(2000);

    }
  }




}

boolean readPMSdata(Stream *s) {
  if (! s->available()) {
    return false;
  }

  // Read a byte at a time until we get to the special '0x42' start-byte
  if (s->peek() != 0x42) {
    s->read();
    return false;
  }

  // Now read all 32 bytes
  if (s->available() < 32) {
    return false;
  }

  uint8_t buffer[32];
  uint16_t sum = 0;
  s->readBytes(buffer, 32);

  // get checksum ready
  for (uint8_t i = 0; i < 30; i++) {
    sum += buffer[i];
  }

  /* debugging
    for (uint8_t i=2; i<32; i++) {
    Serial.print("0x"); Serial.print(buffer[i], HEX); Serial.print(", ");
    }
    Serial.println();
  */

  // The data comes in endian'd, this solves it so it works on all platforms
  uint16_t buffer_u16[15];
  for (uint8_t i = 0; i < 15; i++) {
    buffer_u16[i] = buffer[2 + i * 2 + 1];
    buffer_u16[i] += (buffer[2 + i * 2] << 8);
  }

  // put it into a nice struct :)
  memcpy((void *)&data, (void *)buffer_u16, 30);

  if (sum != data.checksum) {
    //Serial.println("Checksum failure");
    return false;
  }
  // success!
  return true;
}