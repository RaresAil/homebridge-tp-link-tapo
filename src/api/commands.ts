import ChildListInfo, { ChildInfo } from './@types/ChildListInfo';
import DeviceInfo from './@types/DeviceInfo';

type ChildResponse<T> = {
  responseData: {
    result: T;
  };
};

const createBoolCommand =
  <T>(key: string) =>
  (value: T): boolean =>
    ({
      [key]: value
    } as any);

const controlChild = (
  childId: string,
  method: string,
  params?: Record<string, unknown>
) => ({
  __method__: 'control_child',
  device_id: childId,
  requestData: {
    method,
    ...(params ? { params } : {})
  }
});

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
    } as any),
  childDeviceList: (): ChildListInfo =>
    ({
      __method__: 'get_child_device_list'
    } as any),
  getTriggerLogs: (childId: string): any => ({
    ...controlChild(childId, 'get_trigger_logs', {
      start_id: 0,
      page_size: 1
    })
  }),
  stopAlarm: (): boolean =>
    ({
      __method__: 'stop_alarm'
    } as any),
  startAlarm: (): boolean =>
    ({
      __method__: 'play_alarm',
      alarm_type: 'Alarm 4',
      alarm_volume: 'medium'
    } as any),
  getAlarmTypes: (): boolean =>
    ({
      __method__: 'get_support_alarm_type_list'
    } as any),
  getCurrentPower: (): { current_power: number } =>
    ({
      __method__: 'get_current_power'
    } as any),
  childDeviceInfo: (childId: string): ChildResponse<ChildInfo> =>
    ({
      ...controlChild(childId, 'get_device_info')
    } as any)
};
