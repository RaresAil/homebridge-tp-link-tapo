import { PlatformAccessory, Characteristic, Service, Logger } from 'homebridge';

import ColorTemperature from './characteristics/ColorTemperature';
import { HOME_KIT_VALUES } from './utils/translateColorTemp';
import Brightness from './characteristics/Brightness';
import Saturation from './characteristics/Saturation';
import Hue from './characteristics/Hue';
import Context from './@types/Context';
import On from './characteristics/On';
import TPLink from './api/TPLink';
import Platform from './platform';

export type AccessoryThisType = ThisType<{
  readonly powerChar: Characteristic;
  saturation: number;
  tpLink: TPLink;
  hue: number;
}>;

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
      .onGet(On.get.bind(this))
      .onSet(On.set.bind(this));

    this.service
      .getCharacteristic(this.platform.Characteristic.Brightness)
      .onGet(Brightness.get.bind(this))
      .onSet(Brightness.set.bind(this));

    this.service
      .getCharacteristic(this.platform.Characteristic.ColorTemperature)
      .setProps({
        minValue: HOME_KIT_VALUES.min,
        maxValue: HOME_KIT_VALUES.max
      })
      .onGet(ColorTemperature.get.bind(this))
      .onSet(ColorTemperature.set.bind(this));

    this.service
      .getCharacteristic(this.platform.Characteristic.Hue)
      .onGet(Hue.get.bind(this))
      .onSet(Hue.set.bind(this));

    this.service
      .getCharacteristic(this.platform.Characteristic.Saturation)
      .onGet(Saturation.get.bind(this))
      .onSet(Saturation.set.bind(this));

    const adaptiveLightingController =
      new this.platform.api.hap.AdaptiveLightingController(this.service, {
        controllerMode:
          this.platform.api.hap.AdaptiveLightingControllerMode.AUTOMATIC
      });

    this.accessory.configureController(adaptiveLightingController);
  }

  private async updateHueAndSat() {
    if (this._hue !== undefined && this._saturation !== undefined) {
      const h = parseInt(this._hue.toString());
      const s = parseInt(this._saturation.toString());
      this._hue = undefined;
      this._saturation = undefined;
      await this.tpLink.sendCommand('hueAndSaturation', h, s);
    }
  }
}
