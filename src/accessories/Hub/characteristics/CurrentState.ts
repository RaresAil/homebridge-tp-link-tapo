import {
  CharacteristicGetHandler,
  CharacteristicValue,
  Nullable
} from 'homebridge';

import { AccessoryThisType } from '..';

const characteristic: {
  get: CharacteristicGetHandler;
} & AccessoryThisType = {
  get: async function (): Promise<Nullable<CharacteristicValue>> {
    const deviceInfo = await this.tpLink.getInfo();
    return deviceInfo.in_alarm
      ? this.Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED
      : this.Characteristic.SecuritySystemCurrentState.DISARMED;
  }
};

export default characteristic;
