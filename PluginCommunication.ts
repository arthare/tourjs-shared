
export enum PluginType {
  Fake = 0,
  USBWaterRower = 1,
  AntPlusFEC = 2,
  AntPlusPM = 3,
  USBComputrainer = 4,
}
export class PluginDescriptor {
  pluginId: string;
  humanName: string;
  pluginType: PluginType;
  supportsSmartTrainer: boolean;

  constructor(humanName:string, pluginType:PluginType, supportsSmartTrainer:boolean) {
    this.pluginId = '' + Math.random() * 1000000;
    this.humanName = humanName;
    this.pluginType = pluginType;
    this.supportsSmartTrainer = supportsSmartTrainer;
  }

  public static validate(input:any):boolean {
    return input.pluginId && input.humanName && isFinite(input.pluginType);
  }
}

export enum PluginMode {
  Erg = 0,
  Slope = 1,
  Resistance = 2,
}

export interface BrowserToPluginUpdate {
  pluginId: string;
  mode: PluginMode;
  slopePercent: number; // +/- 20
  ergTarget: number; // in watts
  resistancePercent: number; // 0..100
}

export class PluginToBrowserUpdate {
  pluginId:string;
  tmUpdate:number;
  lastPower:number;
  
  constructor(pluginId:string, tmUpdate:number, lastPower:number) {
    this.pluginId = pluginId;
    this.tmUpdate = tmUpdate;
    this.lastPower = lastPower;
  }

  public static validate(input:any):boolean {
    return input.pluginId && isFinite(input.tmUpdate) && isFinite(input.lastPower);
  }
}