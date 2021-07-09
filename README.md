# homebridge-tplink-smart-light

We recommend to use the platform as a Child Bridge for the best performance.

Most of the time the response time between the app and light bulb is 80ms.
With the official app i measured around 1s to 2s as a response time.

### Config

You can add multiple light bulbs with a single platform.

```json
{
  "platforms": [
    {
      "platform": "HomebridgeTPLinkLights",
      "name": "TPLink Light Bulbs",
      "email": "tplink-email",
      "password": "tplink-password",
      "addresses": ["192.168.x.x (the ip address of the light bulb)"]
    }
  ]
}
```
