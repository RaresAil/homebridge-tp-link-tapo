import {
  Characteristic,
  CharacteristicValue,
  Logger,
  PlatformAccessory,
  Service
} from 'homebridge';

import Context from './@types/Context';
import TPLink from './api/TPLink';
import Platform from './platform';
import {
  HOME_KIT_VALUES,
  toHomeKitValues,
  toTPLinkValues,
  TP_LINK_VALUES
} from './utils/translateColorTemp';

export default class LightBulbAccessory {
  private readonly powerChar: Characteristic;
  private readonly service: Service;
  private readonly tpLink: TPLink;

  private _hue?: number;
  private _saturation?: number;

  private set hue(value: number) {
    this._hue = value;
    this.updateHueAndSat();
  }

  private set saturation(value: number) {
    this._saturation = value;
    this.updateHueAndSat();
  }

  public get UUID() {
    return this.accessory.UUID.toString();
  }

  constructor(
    private readonly platform: Platform,
    private readonly accessory: PlatformAccessory<Context>,
    private readonly log: Logger,
    public readonly model: string,
    public readonly mac: string
  ) {
    this.tpLink = accessory.context.tpLink;

    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(
        this.platform.Characteristic.Manufacturer,
        'TP-Link Technologies'
      )
      .setCharacteristic(this.platform.Characteristic.Model, model)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, mac);

    this.service =
      this.accessory.getService(this.platform.Service.Lightbulb) ||
      this.accessory.addService(this.platform.Service.Lightbulb);

    this.powerChar = this.service
      .getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.handleOnGet.bind(this))
      .onSet(this.handleOnSet.bind(this));

    this.service
      .getCharacteristic(this.platform.Characteristic.Brightness)
      .onGet(this.handleBrightnessGet.bind(this))
      .onSet(this.handleBrightnessSet.bind(this));

    this.service
      .getCharacteristic(this.platform.Characteristic.ColorTemperature)
      .setProps({
        minValue: HOME_KIT_VALUES.min,
        maxValue: HOME_KIT_VALUES.max
      })
      .onGet(this.handleColorTemperatureGet.bind(this))
      .onSet(this.handleColorTemperatureSet.bind(this));

    this.service
      .getCharacteristic(this.platform.Characteristic.Hue)
      .onGet(this.handleHueGet.bind(this))
      .onSet(this.handleHueSet.bind(this));

    this.service
      .getCharacteristic(this.platform.Characteristic.Saturation)
      .onGet(this.handleSaturationGet.bind(this))
      .onSet(this.handleSaturationSet.bind(this));
  }

  private async handleOnGet() {
    const deviceInfo = await this.tpLink.getInfo();
    return deviceInfo.device_on || false;
  }

  private async handleOnSet(value: CharacteristicValue) {
    await this.tpLink.sendCommand('power', value as boolean);
  }

  private async handleBrightnessGet() {
    const deviceInfo = await this.tpLink.getInfo();
    return deviceInfo.brightness || 100;
  }

  private async handleBrightnessSet(value: CharacteristicValue) {
    await this.tpLink.sendCommand('brightness', parseInt(value.toString()));
  }

  private async handleColorTemperatureGet() {
    const deviceInfo = await this.tpLink.getInfo();
    return toHomeKitValues(deviceInfo.color_temp || TP_LINK_VALUES.min);
  }

  private async handleColorTemperatureSet(value: CharacteristicValue) {
    const update = await this.tpLink.sendCommand(
      'colorTemp',
      toTPLinkValues(parseInt(value.toString()))
    );

    if (update) {
      this.powerChar.updateValue(true);
    }
  }

  private async handleHueGet() {
    const deviceInfo = await this.tpLink.getInfo();
    return deviceInfo.hue || 0;
  }

  private async handleHueSet(value: CharacteristicValue) {
    this.hue = parseInt(value.toString());
  }

  private async handleSaturationGet() {
    const deviceInfo = await this.tpLink.getInfo();
    return deviceInfo.saturation || 0;
  }

  private async handleSaturationSet(value: CharacteristicValue) {
    this.saturation = parseInt(value.toString());
  }

  private async updateHueAndSat() {
    if (this._hue !== undefined && this._saturation !== undefined) {
      const h = parseInt(this._hue.toString());
      const s = parseInt(this._saturation.toString());
      this._hue = undefined;
      this._saturation = undefined;
      const update = await this.tpLink.sendCommand('hueAndSaturation', h, s);

      if (update) {
        this.powerChar.updateValue(true);
      }
    }
  }
}
