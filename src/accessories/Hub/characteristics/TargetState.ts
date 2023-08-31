import {
  CharacteristicGetHandler,
  CharacteristicSetHandler,
  CharacteristicValue,
  Nullable
} from 'homebridge';

import { AccessoryThisType } from '..';

const characteristic: {
  get: CharacteristicGetHandler;
  set: CharacteristicSetHandler;
} & AccessoryThisType = {
  get: async function (): Promise<Nullable<CharacteristicValue>> {
    const deviceInfo = await this.tpLink.getInfo();
    return deviceInfo.in_alarm
      ? this.Characteristic.SecuritySystemTargetState.AWAY_ARM
      : this.Characteristic.SecuritySystemTargetState.DISARM;
  },
  set: async function (value: CharacteristicValue) {
    try {
      await this.setAlarmEnabled(
        this.Characteristic.SecuritySystemTargetState.AWAY_ARM === value
      );
    } catch (err: any) {
      this.log.error('Failed to set power:', this.mac, '|', err.message);
    }
  }
};

export default characteristic;
