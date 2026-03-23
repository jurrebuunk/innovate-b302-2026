import requests

url = "http://n8n.lan.buunk.org:5678/webhook-test/generate"

data = {
    "items": ["apple", "banana", "robot"],
    "prompt": "a clean product composition",
    "image_url": "http://nixos-usb.lan.buunk.org:3000/api/images/latest"
}

requests.post(url, json=data)