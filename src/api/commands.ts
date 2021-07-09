import DeviceInfo from './@types/DeviceInfo';

const createBoolCommand =
  <T>(key: string) =>
  (value: T): boolean =>
    ({
      [key]: value
    } as any);

export default {
  hueAndSaturation: (hue: number, saturation: number): boolean =>
    ({
      hue,
      saturation,
      color_temp: 0
    } as any),
  brightness: createBoolCommand<number>('brightness'),
  colorTemp: createBoolCommand<number>('color_temp'),
  power: createBoolCommand<boolean>('device_on'),
  deviceInfo: (): DeviceInfo =>
    ({
      __method__: 'get_device_info'
    } as any)
};
