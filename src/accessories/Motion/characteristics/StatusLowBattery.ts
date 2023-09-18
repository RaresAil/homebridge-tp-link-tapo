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
    const deviceInfo = await this.getInfo();
    console.log('TEST: deviceInfo', deviceInfo);
    return deviceInfo.at_low_battery;
  }
};

export default characteristic;
