import { PlatformAccessory, Service, Logger } from 'homebridge';

import On from './characteristics/On';

import DeviceInfo from '../../api/@types/DeviceInfo';
import Accessory from '../../@types/Accessory';
import Context from '../../@types/Context';
import TPLink from '../../api/TPLink';
import Platform from '../../platform';

export type AccessoryThisType = ThisType<{
  readonly tpLink: TPLink;
  readonly log: Logger;
  readonly mac: string;
}>;

export default class LightBulbAccessory extends Accessory {
  private readonly service: Service;

  public get UUID() {
    return this.accessory.UUID.toString();
  }

  constructor(
    platform: Platform,
    accessory: PlatformAccessory<Context>,
    log: Logger,
    deviceInfo: DeviceInfo
  ) {
    super(platform, accessory, log, deviceInfo);

    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(
        this.platform.Characteristic.Manufacturer,
        'TP-Link Technologies'
      )
      .setCharacteristic(this.platform.Characteristic.Model, this.model)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.mac);

    this.service =
      this.accessory.getService(this.platform.Service.Outlet) ||
      this.accessory.addService(this.platform.Service.Outlet);

    this.service
      .getCharacteristic(this.platform.Characteristic.On)
      .onGet(On.get.bind(this))
      .onSet(On.set.bind(this));

    // this.tpLink
    //   .sendCommand('getCurrentPower')
    //   .then((data) => {
    //     console.log(data);
    //   })
    //   .catch((err) => {
    //     console.log(err);
    //   });
  }
}
