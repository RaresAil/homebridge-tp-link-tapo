import {
  PlatformAccessory,
  Logger,
  Characteristic as CharInstance
} from 'homebridge';

import DeviceInfo from '../../api/@types/DeviceInfo';
import Accessory from '../../@types/Accessory';
import Context from '../../@types/Context';
import TPLink from '../../api/TPLink';
import Platform from '../../platform';

import CurrentState from './characteristics/CurrentState';
import TargetState from './characteristics/TargetState';

export type AccessoryThisType = ThisType<{
  readonly Characteristic: typeof import('homebridge').Characteristic;
  readonly setAlarmEnabled: (value: boolean) => Promise<void>;
  readonly alarmEnabled: boolean;
  readonly tpLink: TPLink;
  readonly log: Logger;
  readonly mac: string;
}>;

export interface HubContext {
  name: string;
  child: true;
  parent: string;
}

export default class HubAccessory extends Accessory {
  private readonly Characteristic = this.platform.Characteristic;

  private readonly currentChar: CharInstance;
  private readonly targetChar: CharInstance;

  private prevTarget = false;

  public get UUID() {
    return this.accessory.UUID.toString();
  }

  public async getChildDevices() {
    const response = await this.tpLink.sendCommand('childDeviceList');
    return response.child_device_list;
  }

  public async getChildInfo(childId: string) {
    return this.tpLink.getChildInfo(childId);
  }

  public async getChildLogs(childId: string) {
    const response = await this.tpLink.sendHubCommand(
      'getTriggerLogs',
      childId,
      childId
    );
    return response?.responseData?.result;
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
        this.Characteristic.Manufacturer,
        'TP-Link Technologies'
      )
      .setCharacteristic(this.Characteristic.Model, this.model)
      .setCharacteristic(this.Characteristic.SerialNumber, this.mac);

    const service =
      this.accessory.getService(this.platform.Service.SecuritySystem) ||
      this.accessory.addService(this.platform.Service.SecuritySystem);

    this.currentChar = service
      .getCharacteristic(this.Characteristic.SecuritySystemCurrentState)
      .onGet(CurrentState.get.bind(this));

    this.targetChar = service
      .getCharacteristic(this.Characteristic.SecuritySystemTargetState)
      .setProps({
        validValues: [
          this.Characteristic.SecuritySystemTargetState.DISARM,
          this.Characteristic.SecuritySystemTargetState.AWAY_ARM
        ]
      })
      .onGet(TargetState.get.bind(this))
      .onSet(TargetState.set.bind(this));
  }

  private async setAlarmEnabled(value: boolean) {
    if (this.prevTarget === value) {
      this.currentChar.updateValue(
        this.prevTarget
          ? this.Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED
          : this.Characteristic.SecuritySystemCurrentState.DISARMED
      );
      this.targetChar.updateValue(
        this.prevTarget
          ? this.Characteristic.SecuritySystemTargetState.AWAY_ARM
          : this.Characteristic.SecuritySystemTargetState.DISARM
      );
      return;
    }

    this.prevTarget = value;

    if (value) {
      await this.tpLink.sendCommand('startAlarm');
      this.currentChar.updateValue(
        this.Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED
      );
      this.targetChar.updateValue(
        this.Characteristic.SecuritySystemTargetState.AWAY_ARM
      );
      return;
    }

    await this.tpLink.sendCommand('stopAlarm');
    this.currentChar.updateValue(
      this.Characteristic.SecuritySystemCurrentState.DISARMED
    );
    this.targetChar.updateValue(
      this.Characteristic.SecuritySystemTargetState.DISARM
    );
  }
}
