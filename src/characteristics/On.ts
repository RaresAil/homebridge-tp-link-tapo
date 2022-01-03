import {
  CharacteristicGetHandler,
  CharacteristicSetHandler,
  CharacteristicValue,
  Nullable
} from 'homebridge';

import { AccessoryThisType } from '../LightBulbAccessory';

const characteristic: {
  get: CharacteristicGetHandler;
  set: CharacteristicSetHandler;
} & AccessoryThisType = {
  get: async function (): Promise<Nullable<CharacteristicValue>> {
    const deviceInfo = await this.tpLink.getInfo();
    return deviceInfo.device_on || false;
  },
  set: async function (value: CharacteristicValue) {
    await this.tpLink.sendCommand('power', value as boolean);
  }
};

export default characteristic;
