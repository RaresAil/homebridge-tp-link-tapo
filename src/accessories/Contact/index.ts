import { PlatformAccessory, Logger } from 'homebridge';

import { ChildInfo } from '../../api/@types/ChildListInfo';
import HubAccessory, { HubContext } from '../Hub';
import Accessory from '../../@types/Accessory';
import Context from '../../@types/Context';
import Platform from '../../platform';
import delay from '../../utils/delay';

import StatusLowBattery from './characteristics/StatusLowBattery';

export enum Status {
  KeepOpen = 'keepOpen',
  Closed = 'close',
  Open = 'open'
}

export type AccessoryThisType = ThisType<{
  readonly hub: HubAccessory;
  readonly getInfo: () => Promise<ChildInfo>;
}>;

export default class ContactAccessory extends Accessory {
  private interval?: NodeJS.Timeout;
  private lastEventUpdate = 0;

  public get UUID() {
    return this.accessory.UUID.toString();
  }

  private getInfo() {
    return this.hub.getChildInfo(this.deviceInfo.device_id);
  }

  constructor(
    private readonly hub: HubAccessory,
    platform: Platform,
    accessory: PlatformAccessory<HubContext>,
    log: Logger,
    deviceInfo: ChildInfo
  ) {
    super(
      platform,
      accessory as unknown as PlatformAccessory<Context>,
      log,
      deviceInfo
    );

    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(
        this.platform.Characteristic.Manufacturer,
        'TP-Link Technologies'
      )
      .setCharacteristic(this.platform.Characteristic.Model, this.model)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.mac);

    const service =
      this.accessory.getService(this.platform.Service.ContactSensor) ||
      this.accessory.addService(this.platform.Service.ContactSensor);

    const characteristic = service.getCharacteristic(
      this.platform.Characteristic.ContactSensorState
    );

    service
      .getCharacteristic(this.platform.Characteristic.StatusLowBattery)
      .onGet(StatusLowBattery.get.bind(this));

    const checkStatus = async (initStatus?: Status) => {
      try {
        if (initStatus) {
          characteristic.updateValue(this.statusToValue(initStatus));
        }

        const response = await this.hub.getChildLogs(this.deviceInfo.device_id);
        if (!response) {
          this.log.warn('Failed to check for updates, delaying 500ms');
          await delay(500);
        }

        const lastEvent = response?.logs?.[0];
        if (this.lastEventUpdate < lastEvent?.timestamp) {
          this.lastEventUpdate = lastEvent?.timestamp ?? 0;
          characteristic.updateValue(this.statusToValue(lastEvent?.event));
        }
      } catch (error) {
        this.log.error('Failed to check for updates', error);
        await delay(500);
      }

      checkStatus();
    };

    this.setup((x) => checkStatus(x));
  }

  cleanup() {
    clearInterval(this.interval!);
  }

  private async setup(callback: (x: Status) => void) {
    const init = await this.hub.getChildLogs(this.deviceInfo.device_id);
    const initEvent = init?.logs?.[0];
    this.lastEventUpdate = initEvent?.timestamp ?? 0;
    callback(initEvent?.event ?? Status.KeepOpen);
  }

  private statusToValue(status: Status) {
    switch (status) {
      case Status.Open:
      case Status.KeepOpen:
        return this.platform.Characteristic.ContactSensorState
          .CONTACT_NOT_DETECTED;
      default:
        return this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED;
    }
  }
}
