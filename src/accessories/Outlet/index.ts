import { PlatformAccessory, Service, Logger } from 'homebridge';

import InUse from './characteristics/InUse';
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

    this.setupAdditionalCharacteristics();
  }

  private async setupAdditionalCharacteristics() {
    const current = this.service.getCharacteristic(
      this.platform.Characteristic.ContactSensorState
    );

    try {
      const check = await this.tpLink.sendCommand('getCurrentPower');
      if (
        check.current_power === undefined ||
        check.current_power === null ||
        !Number.isFinite(check.current_power)
      ) {
        throw new Error('Not supported');
      }

      (
        current ||
        this.service.addCharacteristic(
          this.platform.Characteristic.ContactSensorState
        )
      ).onGet(InUse.get.bind(this));

      this.log.debug('InUse characteristic supported.');
    } catch {
      this.log.debug('InUse characteristic not supported, ignoring.');

      if (current) {
        this.service.removeCharacteristic(current);
      }
    }
  }
}
