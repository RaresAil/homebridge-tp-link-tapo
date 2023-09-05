# Homebridge TP-Link Tapo

[![Discord](https://img.shields.io/discord/942035865658613790.svg?label=&logo=discord&logoColor=ffffff&color=7389D8&labelColor=6A7EC2)](https://discord.gg/CAvGGvRGB3)

[![Build and Lint](https://github.com/RaresAil/homebridge-tp-link-tapo/actions/workflows/build.yml/badge.svg)](https://github.com/RaresAil/homebridge-tp-link-tapo/actions/workflows/build.yml)
[![CodeQL](https://github.com/RaresAil/homebridge-tp-link-tapo/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/RaresAil/homebridge-tp-link-tapo/actions/workflows/codeql-analysis.yml)

[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
![Snyk Vulnerabilities for npm package](https://img.shields.io/snyk/vulnerabilities/npm/homebridge-tp-link-tapo)
![npm](https://img.shields.io/npm/dm/homebridge-tp-link-tapo)

I recommend to use the platform as a Child Bridge for the best performance.

Most of the time the response time between the app and the device is 80ms.
With the official app i measured around 1s to 2s as a response time.

### Migrate to V3

The platform name was changed to `HomebridgeTPLinkTapo` from HomebridgeTPLinkLights

Package was renamed from `homebridge-tplink-smart-light` to `homebridge-tp-link-tapo`

### Current device types

- Socket/Outlet (For devices with power measurement, they have a contact sensor, open means the current is > 0 and closed is 0)
- Hub (As alarm)
- Button S200
- Contact Sensor (T110)
- Light Bulb
- LED Strip

For other device type just open a issue.

### Config

You can add multiple devices bulbs with a single platform.

```json
{
  "platforms": [
    {
      "platform": "HomebridgeTPLinkTapo",
      "name": "TPLink Tapo Platform",
      "email": "tplink-email",
      "password": "tplink-password",
      "addresses": ["192.168.x.x (the ip address of the device)"]
    }
  ]
}
```
