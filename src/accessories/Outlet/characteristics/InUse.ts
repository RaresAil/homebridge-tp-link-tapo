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
    const response = await this.tpLink.cacheSendCommand(
      this.mac,
      'getCurrentPower'
    );

    return response.current_power > 0;
  }
};

export default characteristic;
