interface DeviceInfo {
  color_temp_range?: [number, number];
  device_id: string;
  fw_ver: string;
  hw_ver: string;
  type: string;
  model: string;
  mac: string;
  hw_id: string;
  fw_id: string;
  oem_id: string;
  specs: string;
  in_alarm?: boolean;
  lang: string;
  device_on: boolean;
  on_time: number;
  overheated: boolean;
  nickname: string;
  avatar: string;
  brightness: number;
  dynamic_light_effect_enable: boolean;
  color_temp: number;
  hue: number;
  saturation: number;
  default_states: {
    type: 'last_states';
    state: {
      [key: string]: any;
    };
  };
  time_diff: number;
  region: string;
  longitude: number;
  latitude: number;
  has_set_location_info: boolean;
  ip: string;
  ssid: string;
  signal_level: number;
  rssi: number;
}

export default DeviceInfo;
