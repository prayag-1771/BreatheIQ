import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
import serial
import time
import warnings
import requests  # For ThingSpeak

import os

api = os.environ.get("THINGSPEAK_API_KEY", "")  # ThingSpeak write key — set it in your environment, never commit it
warnings.filterwarnings("ignore")

ser = serial.Serial('COM5', baudrate=115200)  # Adjust COM port and baudrate as needed
print("Serial connection opened successfully!")

# Load data from an Excel sheet and split into features and labels
data = pd.read_excel("TK172529.xlsx", engine="openpyxl")

feature_1 = data[['Temperature']]
feature_2 = data[['Gas']]
feature_3 = data[['CO2']]
feature_4 = data[['Pms']]

label_1 = data['label_Temperature']
label_2 = data['label_Gas']
label_3 = data['label_CO2']
label_4 = data['label_Pms']

# Split the data into training and testing sets for each parameter
X_train_1, X_test_1, y_train_1, y_test_1 = train_test_split(feature_1, label_1, test_size=0.2, random_state=42)
X_train_2, X_test_2, y_train_2, y_test_2 = train_test_split(feature_2, label_2, test_size=0.2, random_state=42)
X_train_3, X_test_3, y_train_3, y_test_3 = train_test_split(feature_3, label_3, test_size=0.2, random_state=42)
X_train_4, X_test_4, y_train_4, y_test_4 = train_test_split(feature_4, label_4, test_size=0.2, random_state=42)

# Build Random Forest models for each parameter
model_1 = RandomForestClassifier(random_state=42)
model_1.fit(X_train_1, y_train_1)

model_2 = RandomForestClassifier(random_state=42)
model_2.fit(X_train_2, y_train_2)

model_3 = RandomForestClassifier(random_state=42)
model_3.fit(X_train_3, y_train_3)

model_4 = RandomForestClassifier(random_state=42)
model_4.fit(X_train_4, y_train_4)

# Function for Text-to-Speech conversion
def text_to_speech(text, lang='en'):
    tts = gTTS(text=text, lang=lang, slow=False)
    tts.save("output.mp3")
    os.system("start output.mp3")  # Windows
    # os.system("afplay output.mp3")  # macOS
    # os.system("xdg-open output.mp3")  # Linux

def readData():
    time.sleep(1)
    serial_data = ser.readline().decode().strip()
    print("\n----------------------------")
    print("     -= Data Received =- ")
    print("----------------------------\n")
    print("Data:", serial_data, "\n")
    time.sleep(1)

    try:
        a = serial_data.find("a") + 1
        b = serial_data.find("b")
        if a > 0 and b > a:
            Temperature = float(serial_data[a:b])
        else:
            Temperature = 0.0
    except ValueError:
        Temperature = 0.0
    print("Temperature:", Temperature)

    try:
        b = serial_data.find("b") + 1
        c = serial_data.find("c")
        if b > 0 and c > b:
            Gas = int(serial_data[b:c])
        else:
            Gas = 0
    except ValueError:
        Gas = 0
    print("Gas:", Gas)

    try:
        c = serial_data.find("c") + 1
        d = serial_data.find("d")
        if c > 0 and d > c:
            CO2 = int(serial_data[c:d])
        else:
            CO2 = 0
    except ValueError:
        CO2 = 0
    print("CO2:", CO2)

    try:
        d = serial_data.find("d") + 1
        e = serial_data.find("e")
        if d > 0 and e > d:
            Pms = int(serial_data[d:e])
        else:
            Pms = 0
    except ValueError:
        Pms = 0
    print("Pms:", Pms)

    return Temperature, Gas, CO2, Pms


while True:
    Temperature, Gas, CO2, Pms = readData()
    time.sleep(1)
    print("Uploading data to webserver....")
    time.sleep(2)

    queries = {"api_key": api, "field1": Temperature, "field2": Gas, "field3": Pms}
    r = requests.get('https://api.thingspeak.com/update', params=queries)

    if r.status_code == requests.codes.ok:
        print("Data Successfully Uploaded!")
    else:
        print("Error Code: " + str(r.status_code))
        time.sleep(1)

    x_prediction = model_1.predict([[Temperature]])[0]
    y_prediction = model_2.predict([[Gas]])[0]
    z_prediction = model_3.predict([[CO2]])[0]
    w_prediction = model_4.predict([[Pms]])[0]

    print("\nPredictions:")
    print(f'X Prediction: {x_prediction}')
    print(f'Y Prediction: {y_prediction}')
    print(f'Z Prediction: {z_prediction}')
    print(f'W Prediction: {w_prediction}')
     
    # TTS in the if conditions
    if x_prediction == 1:
        print("Abnormal temperature detected")
       
    else:
        print("Temperature is normal")
       # text_to_speech("Body Temperature is normal.")

    if y_prediction == 1:
        print("Abnormal Gases detected")
    else:
        print("Gases is normal")
       # text_to_speech("Humidity is normal.")

    if z_prediction == 1:
        print("CO2 detected")
    else:
        print("Air Quality is normal")
      #  text_to_speech("BPM is normal.")
      

    if w_prediction == 1:
        print("Dust Particles detected")
    else:
        print("No Dust particles Detected ")
        #text_to_speech("Mems is normal.")

    values_string = f"t{x_prediction:.0f}u{y_prediction:.0f}v{z_prediction:.0f}x{w_prediction:.0f}y   "
    time.sleep(2)
    print(values_string)
    time.sleep(3)
    ser.write(bytes(values_string, 'utf-8'))
    time.sleep(3)
    print("Completed")
    time.sleep(3)
