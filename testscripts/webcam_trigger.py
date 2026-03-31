import cv2
from pathlib import Path
import requests

url = "http://n8n.lan.buunk.org:5678/webhook-test/7c817235-db8e-49e8-b985-887fadce5c3f"

# Capture image from webcam
cap = cv2.VideoCapture(0)
ret, frame = cap.read()
cap.release()

if ret:
    image_path = Path(__file__).with_name("picture.png")
    cv2.imwrite(str(image_path), frame)

    # Send the image to the API
    with image_path.open("rb") as image_file:
        requests.post(
            url,
            files={"file": (image_path.name, image_file, "image/png")},
        )
else:
    print("Failed to capture image")