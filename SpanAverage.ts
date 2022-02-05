import { assert2 } from "./Utils";

class SpanSample {
  constructor(tm:number, dt:number,power:number) {
    this.tm = tm;
    this.dt = dt;
    this.power = power;
  }
  tm:number;
  dt:number;
  power:number;
}

export class SpanAverage {
  samples:SpanSample[] = [];
  dtSum:number = 0;
  powerSum:number = 0;
  tmLast:number = 0;
  secondsSpan:number = 0;

  constructor(secondsSpan:number) {
    this.reset(secondsSpan);
  }

  reset(secondsSpan:number) {
    this.samples = [];
    this.dtSum = 0;
    this.powerSum = 0;
    this.tmLast = 0;
    this.secondsSpan = secondsSpan;
  }

  isReady():boolean {
    if(this.samples.length <= 0) {
      return false;
    }

    const oldest = this.samples[0];
    const newest = this.samples[this.samples.length - 1];
    const spanSeconds = (newest.tm - oldest.tm) / 1000.0;
    return spanSeconds >= this.secondsSpan * 0.95; // if we're half full, call us ready
  }
  getAverage():number {
    if(!this.isReady()) {
      return 0;
    }

    return this.powerSum / this.dtSum;
  }

  add(tmNow:number, power:number) {
    if(this.tmLast === 0) {
      this.tmLast = tmNow;
      return;
    }

    const dt = (tmNow - this.tmLast) / 1000;
    if(dt > 2) {
      // err what
      this.tmLast = tmNow;
      return;
    }
    this.dtSum += dt;
    this.powerSum += dt*power;
    this.samples.push(new SpanSample(tmNow, dt, power));

    let ixSlice = 0;
    while(this.samples.length > 0) {
      const sample = this.samples[ixSlice];
      const leadTimeAgoSeconds = (tmNow - sample.tm)/1000;
      if(leadTimeAgoSeconds > this.secondsSpan) {
        // this is too far ago, and shouldn't be counted anymore
        ixSlice++;
        this.dtSum -= sample.dt;
        this.powerSum = Math.max(0, this.powerSum - sample.power*sample.dt);
        assert2(this.powerSum >= 0);
      } else {
        // this is within our span, so we're done our slicing
        break;
      }
    }
    this.samples = this.samples.slice(ixSlice);
    
  }
}