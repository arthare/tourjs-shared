import { User, UserTypeFlags, DEFAULT_HANDICAP_POWER, DEFAULT_RIDER_MASS, UserInterface, DistanceHistoryElement, HandicapChangeReason } from "./User";
import { UserProvider, RaceState, getAIStrengthBoostForDistance } from "./RaceState";
import { ClientConnectionRequest, CurrentRaceState, S2CFinishUpdate } from "./communication";
import { RideMap } from "./RideMap";
import { assert2 } from "./Utils";
import { SERVER_PHYSICS_FRAME_RATE } from "./ServerConstants";
import fs from 'fs';
import { SpanAverage } from "./SpanAverage";
import { BrainLocation, brainPath, makeTensor, normalizeData, NormData, predictFromRawTrainingData, takeTrainingSnapshot, TrainingDataPrepped, TrainingSnapshotV2, trainingSnapshotToAIInput, unnormalizeData } from "./ServerAISnapshots";
import * as tf from '@tensorflow/tfjs-node';
import { LayersModel, Sequential, Tensor, Tensor2D } from '@tensorflow/tfjs-node';
import {v4 as uuidv4} from 'uuid';
import { StatsData } from "./StatsData";

export class ServerUser extends User {
  _tmLastNameSent:number;
  _tmLastFinishUpdate:number;
  _tmLastImageUpdate:number;
  _usersIveBeenSentImagesFor:Set<number> = new Set();

  _spanAverages:Map<number,SpanAverage> = new Map<number, SpanAverage>();
  _wsConnection:WebSocket|null;
  _raceState:RaceState;
  _sub:string; // auth0 sub uniquely identifying the owner of this rider.  When someone joins (or reconnects), they send this along so we can figure out who they are

  constructor(sub:string, name:string, massKg:number, handicap:number, typeFlags:number, wsConnection:WebSocket|null, raceState:RaceState) {
    super(name, massKg, handicap, typeFlags);

    this._sub = sub;
    this._tmLastFinishUpdate = -1;
    this._tmLastNameSent = -1;
    this._tmLastImageUpdate = -1;
    this._wsConnection = wsConnection;
    this._raceState = raceState;

    const minutesForSpans = [5,10,20,30,45,60];
    minutesForSpans.forEach((minutes) => {
      this._spanAverages.set(minutes, new SpanAverage(minutes*60));
    })
  }

  physicsTick(tmNow: number, map: RideMap, otherUsers: UserInterface[]): void {
    super.physicsTick(tmNow, map, otherUsers);

    StatsData.note(`User[${this.getUserType()}] physicsTick`);
    StatsData.note(`User[any] physicsTick`);
  }
  getSub():string {
    return this._sub;
  }
  getWebSocket():WebSocket|null {
    return this._wsConnection;
  }

  hasBeenSentImageFor(userId:number) {
    return this._usersIveBeenSentImagesFor.has(userId);
  }
  noteImageSent(tmNow:number, userId:number) {
    this._usersIveBeenSentImagesFor.add(userId);
    this._tmLastImageUpdate = tmNow;
  }
  getLastImageUpdate() {
    return this._tmLastImageUpdate;
  }

  noteLastNameUpdate(tmWhen:number) {
    this._tmLastNameSent = tmWhen;
  }
  getLastNameUpdate():number {
    return this._tmLastNameSent;
  }
  
  public getTimeSinceFinishUpdate(tmNow:number):number {    
    return tmNow - this._tmLastFinishUpdate;
  }
  public noteFinishUpdate(tmNow:number) {
    this._tmLastFinishUpdate = tmNow;
  }
  public setPosition(where:number) {
    this._position = where;
  }

  _pendingTrainingSnapshot:TrainingSnapshotV2|null = null;
  _tmTrainingSnapshot:number = 0;
  private _takeTrainingSnapshot(tmNow:number) {


    if(tmNow - this._tmTrainingSnapshot > 1500) {
      StatsData.note("Take training snapshot");
      
      if(this._pendingTrainingSnapshot) {
        // we've got an old training snapshot that needs our current power filled in, and then needs to get dumped to disk
        this._pendingTrainingSnapshot.powerNextSecond = this.getLastPower() / this.getHandicap();
        fs.appendFile(brainPath(`${this.getName()}-v${this._pendingTrainingSnapshot.version}-${this.getBigImageMd5()}.training`, BrainLocation.ForTraining), JSON.stringify(this._pendingTrainingSnapshot, undefined, '\t') + "\n$$\n", {}, ()=>{});
        this._pendingTrainingSnapshot = null;
      }
      
      this._pendingTrainingSnapshot = takeTrainingSnapshot(tmNow, this, this._raceState);
      this._tmTrainingSnapshot = tmNow;
    }
    
  }
  

  public notifyPower(tmNow:number, watts:number):void {
    super.notifyPower(tmNow, watts);
    StatsData.note("User [any] notifypower");

    if(!(this.getUserType() & UserTypeFlags.Ai)) {
      StatsData.note("User [human] notifypower");
      // we're a human
      this._spanAverages.forEach((span, minutes) => {
        span.add(tmNow, watts);
      });

      this._takeTrainingSnapshot(tmNow);

      const span5:SpanAverage|undefined = this._spanAverages.get(5);
      const span10:SpanAverage|undefined = this._spanAverages.get(10);
      const span20:SpanAverage|undefined = this._spanAverages.get(20);

      // for posterity, the old TdG conversion ratios from less-than-hour rides to hour rides were:
      //const static float flRatios[] = 
      //{
      //  0,
      //  0,
      //  0, // 10s
      //  0, // 30s
      //  0, // 60s
      //  0.776f, // 2min
      //  0.835f, // 5min
      //  0.879f, // 10min
      //  0.912f, // 20min
      //  0.938f, // 30min
      //  0.968f, // 45min
      //  1, // 60min
      //};
      // I think I'll just use 5/10/20.  The 2min one ends up estimating quite high


      let estSum = 0;
      let estCount = 0;
      if(span5 && span5.isReady()) {
        const avg = span5.getAverage();
        if(avg <= 0) {
          // if we've been sitting still for 5 minutes, then just reset the longer ones.
          // why?
          // 1) since we use the average of 3 estimates, someone could significantly nerf the re-handicapper by filling their 10min/20min with zeros
          // 2) so if we reset 10min/20min counts, then when they start riding they'll be handicapped by the fairly-accurate 5min, and 10/20 will come into
          //    play with all-nonzero data, rather than showing up mostly-zeroed
          // other solutions considered:
          // 1) Solution: don't put zeros into the spanaverages
          //    Problem: that's unfair to someone that does 2min hard, 1min stopped, then 3min hard again - it'd look like they did 5min flat-out, when they actually had a rest
          if(span10) {
            span10.reset(10*60);
          }
          if(span20) {
            span20.reset(20*60);
          }
        }
        estSum += avg*0.835;
        estCount++;
      }
      if(span10 && span10.isReady()) {
        const avg = span10.getAverage();

        estSum += avg*0.879;
        estCount++;
      }
      if(span20 && span20.isReady()) {
        const avg = span20.getAverage();

        estSum += avg*0.912;
        estCount++;
      }

      if(estCount > 0) {
        const estFTP = estSum / estCount;
        if(estFTP >= this.getHandicap()*1.02) {
          StatsData.note("User [human] update FTP");
          console.log("revising " + this.getName() + "'s FTP to " + estFTP.toFixed(1));
          this.setHandicap(estFTP, HandicapChangeReason.ServerRehandicap);
        }
      }

    }
  }
}

let userIdCounter = 0;
const userIdToUserMap:Map<number, ServerUser> = new Map<number,ServerUser>();
export class ServerUserProvider implements UserProvider {
  constructor() {
    this.users = [];
  }
  getLocalUser(): User | null {
    return null;
  }
  getUsers(tmNow:number): ServerUser[] {
    return this.users.filter((user) => {
      return user.getMsSinceLastPacket(tmNow) < 300000 ||  // either this user is still obviously connected
             user.isFinished() ||
             user.getUserType() & (UserTypeFlags.Ai | UserTypeFlags.Bot); // or this user has finished
    });
  }
  getUser(id:number):ServerUser|null {
    return this.users.find((user) => user.getId() === id) || null;
  }
  addUser(ccr:ClientConnectionRequest, wsConnection:WebSocket|null, userTypeFlags:UserTypeFlags, raceState:RaceState):number {

    if(!userTypeFlags) {
      userTypeFlags = 0;
    }

    let newId = userIdCounter++;
    const user = new ServerUser(ccr.sub, ccr.riderName, DEFAULT_RIDER_MASS, ccr.riderHandicap, UserTypeFlags.Remote | userTypeFlags, wsConnection, raceState);
    if(user.getUserType() & (UserTypeFlags.Ai | UserTypeFlags.Bot)) {
      assert2(wsConnection === null);
    } else {
      assert2(wsConnection !== null);
    }

    if(ccr.imageBase64) {
      console.log("user ", ccr.riderName, " has an image!");
      user.setImage(ccr.imageBase64, ccr.bigImageMd5);
    }
    user.setId(newId);
    this.users.push(user);
    userIdToUserMap.set(newId, user);
    return newId;    
  }

  users:ServerUser[];
}

export interface AIBrain {
  getPower(timeSeconds:number, handicap:number, dist:number, mapLength:number, slopeWholePercent:number):number;
  isNN():boolean;
  getPowerNN(handicap:number, data:TrainingSnapshotV2):number;
  getName(handicap:number):string;
  finishLoadPromise():Promise<any>;
}


export class AINNBrain implements AIBrain {
  _model:LayersModel|null = null;
  _name:string;
  _strength:number;
  _norms:any;
  _finishLoad:Promise<any>;
  constructor(strength:number, brain:string) {

    assert2(strength >= 0.75 && strength <= 1.05);
    strength *= 1.05;

    const totalPath = brainPath(brain, BrainLocation.Deployed);
    this._finishLoad = new Promise<void>((resolve, reject) => {
      try {
        tf.loadLayersModel(`file://${totalPath}/model.json`).then((model:LayersModel) => {
          const rawNorms = JSON.parse(fs.readFileSync(totalPath  + '/norm.json', 'utf8'));
          this._norms = {};
          for(var key in rawNorms) {
            rawNorms[key] = Object.values(rawNorms[key]);
          }
          const inputMinMax = makeTensor(tf, [rawNorms.inputMax, rawNorms.inputMin]);
          const labelMinMax = makeTensor(tf, [rawNorms.labelMax, rawNorms.labelMin]);
          this._norms = new NormData(inputMinMax, labelMinMax, rawNorms.killCols);
          this._model = model;
          resolve();
        })

      } catch(e) {
        reject(e);
      }
    })
    this._strength = strength;

    this._name = brain.split('-')[0];
  }
  finishLoadPromise() {
    return this._finishLoad;
  }
  getPower(timeSeconds: number, handicap: number, dist: number, mapLength: number, slopeWholePercent: number): number {

    return this._strength * handicap;
  }
  isNN() {return !!this._model;}
  getPowerNN(handicap:number, data:TrainingSnapshotV2|null):number {
    if(!data) {
      // just default to something basic if we don't have our data yet
      return handicap * 1.0;
    }
    if(this._model && data.distanceToFinish > 0) {

      StatsData.note("AI predictFromRaw");
      const ret = handicap * this._strength * predictFromRawTrainingData(tf, this._model, this._norms, data);
      return ret;
    }
    StatsData.note("AI getPower");
    return this.getPower(0, handicap, data.distanceInRace, data.distanceInRace + data.distanceToFinish, data.avgSlopeCurrentUphill);
  }
  getName(handicap: number): string {
    return `${this._name}Bot ${(this._strength*100).toFixed(0)}%`;
  }
  
}
export class AIUltraBoringBrain implements AIBrain {
  _nextChange = 0;
  _currentOutput = 0;
  _strength = 0;
  constructor(strength:number) {
    this._strength = strength;
  }
  finishLoadPromise() {
    return Promise.resolve();
  }
  getPower(timeSeconds:number, handicap:number, dist:number, mapLength:number, slopeWholePercent:number):number {
    return this._strength * DEFAULT_HANDICAP_POWER;
  }
  isNN() {return false;}
  getPowerNN(handicap:number, data:TrainingSnapshotV2):number {
    throw new Error("Not implemented");
  }
  getName(handicap:number):string {
    return `UltraBore`;
  }
}
export class AIBoringBrain implements AIBrain {
  _nextChange = 0;
  _currentOutput = 0;
  _strength = 0;
  constructor(strength:number) {
    this._strength = strength;
  }
  finishLoadPromise() {
    return Promise.resolve();
  }
  getPower(timeSeconds:number, handicap:number, dist:number, mapLength:number, slopeWholePercent:number):number {
    if(timeSeconds > this._nextChange || this._currentOutput <= 0) {
      this._nextChange = timeSeconds + Math.random()*15 + 5;

      const spread = handicap * 0.15;
      this._currentOutput = Math.max(0, handicap + Math.random()*spread*2 - spread);
    }

    return this._strength * this._currentOutput;
  }
  isNN() {return false;}
  getPowerNN(handicap:number, data:TrainingSnapshotV2):number {
    throw new Error("Not implemented");
  }
  getName(handicap:number):string {
    return `Boring ${(this._strength*100).toFixed(0)}%`;
  }
}
class AISineBrain implements AIBrain {
  private _period:number;
  private _magnitude:number; // as a fraction of our handicap
  private _strength = 0;
  constructor(strength:number) {
    this._period = Math.random()*30 + 30;
    this._magnitude = Math.random()*0.4;
    this._strength = strength;
  }
  finishLoadPromise() {
    return Promise.resolve();
  }
  getPower(timeSeconds:number, handicap:number, dist:number, mapLength:number, slopeWholePercent:number):number {
    const mod = handicap * this._magnitude * Math.sin(timeSeconds * 2 * Math.PI / this._period);
    return this._strength * Math.max(0, handicap + mod);
  }
  isNN() {return false;}
  getPowerNN(handicap:number, data:TrainingSnapshotV2):number {
    throw new Error("Not implemented");
  }
  getName(handicap:number):string {
    return `Sine ${(this._strength*100).toFixed(0)}%`;
  }
}
class AIHillBrain implements AIBrain {
  private _magnitude:number; // as a fraction of our handicap
  private _strength = 0;
  constructor(strength:number) {
    this._magnitude = 0.9 + Math.random()*0.2;
    this._strength = strength;
  }
  finishLoadPromise() {
    return Promise.resolve();
  }
  getPower(timeSeconds:number, handicap:number, dist:number, mapLength:number, slopeWholePercent:number):number {
    const modSlope = this._magnitude*slopeWholePercent / 100.0 + 1.0;
    return this._strength * Math.max(0, handicap * modSlope);
  }
  isNN() {return false;}
  getPowerNN(handicap:number, data:TrainingSnapshotV2):number {
    throw new Error("Not implemented");
  }
  getName(handicap:number):string {
    return `Hill ${(this._strength*100).toFixed(0)}%`;
  }
}
class DumbSavey implements AIBrain {
  private _fractionOfLengthToSave = 0.95;
  private _fractionToSaveAt = 0.98;
  private _strength = 0;
  constructor(strength:number) {
    this._fractionOfLengthToSave = 0.9 + Math.random() * 0.075;
    this._fractionToSaveAt = 0.95 + Math.random() * 0.04;
    this._strength = strength;
  }
  finishLoadPromise() {
    return Promise.resolve();
  }
  getPower(timeSeconds:number, handicap:number, dist:number, mapLength:number, slopeWholePercent:number):number {

    const myPctOfMap = dist / mapLength;
    if(myPctOfMap < this._fractionOfLengthToSave) {
      return this._strength * handicap * this._fractionToSaveAt;
    } else {
      const fractionOfLengthToChargeAt = 1 - this._fractionOfLengthToSave;
      const chargeEffort = (1 - (this._fractionOfLengthToSave*this._fractionToSaveAt)) / fractionOfLengthToChargeAt;
      return chargeEffort * handicap;
    }
  }
  isNN() {return false;}
  getPowerNN(handicap:number, data:TrainingSnapshotV2):number {
    throw new Error("Not implemented");
  }
  getName(handicap:number):string {
    return `Savey ${(this._strength*100).toFixed(0)}%`;
  }
}

function getNextAIBrain(strength:number, brains:string[]):AIBrain {
  assert2(strength >= 0.75 && strength <= 1.05);

  const nAis = 5;
  const val = Math.floor(Math.random() * nAis);
  switch(val) {
    default:
    case 0:
      return new AIBoringBrain(strength);
    case 1:
      return new AISineBrain(strength);
    case 2:
      return new AIHillBrain(strength);
    case 3:
      return new DumbSavey(strength);
    case 4:
      try {
        if(brains.length > 0) {
          const ixBrain = Math.floor(Math.random() * brains.length);
          return new AINNBrain(strength, brains[ixBrain]);
        } else {
          return new DumbSavey(strength);
        }
      } catch(e) {
        return new DumbSavey(strength);
      }
      
  }
}


export function getBrainFolders():string[] {
  const brainWhere = brainPath('', BrainLocation.Deployed);
  const possibleBrains = fs.readdirSync(brainWhere);
  const brains = possibleBrains.filter((path) => fs.statSync(brainPath(path, BrainLocation.Deployed)).isDirectory() && path.endsWith('.brain'));
  return brains;
}

export class ServerGame {

  constructor(map:RideMap, gameId:string, name:string, cAis:number) {
    this.userProvider = new ServerUserProvider();
    this.raceState = new RaceState(map, this.userProvider, gameId);
    this._aiBrains = new Map();
    this._tmLastAiUpdate = new Date().getTime();

    const aiStrengthBoost = getAIStrengthBoostForDistance(map.getLength());

    const brains = getBrainFolders();

    for(var x = 0;x < cAis; x++) {
      const aiStrength = Math.random()*0.25 + 0.80;
      const aiBrain = getNextAIBrain(aiStrength, brains);

      const aiId = this.userProvider.addUser({
        sub: `ai_${uuidv4()}`,
        riderName:aiBrain.getName(aiStrength),
        accountId:"-1",
        riderHandicap: 300*aiStrengthBoost,
        gameId:gameId,
        imageBase64: null,
        bigImageMd5: null,
      }, null, UserTypeFlags.Ai, this.raceState);

      this._aiBrains.set(aiId, aiBrain);
    }

    this._timeout = null;
    this._tmScheduledRaceStart = -1;
    this._tmRaceStart = -1;
    this._name = name;
    this._gameId = gameId;
  }

  public getDisplayName() {
    return this._name;
  }
  public getGameId() {
    return this._gameId;
  }

  public findUserByImage(tmNow:number, imageBase64:string, riderName:string, handicap:number):ServerUser|null {

    const users = this.userProvider.getUsers(tmNow);
    const found:UserInterface|null = users.find((user) => {
      return !(user.getUserType() & UserTypeFlags.Ai) &&
              user.getHandicap() === handicap &&
              user.getName() === riderName &&
             user.getImage() && user.getImage() === imageBase64;
    }) || null;

    if(found) {
      return <ServerUser>found;
    }
    return null;
  }

  private start(tmNow:number) {
    this._tmRaceStart = tmNow;
    this._tmLastAiUpdate = tmNow;
    this._scheduleTick();
  }
  public stop() {
    this._stopped = true;
    this.raceState.stop();
  }
  public addUser(tmNow:number, ccr:ClientConnectionRequest, wsConnection:WebSocket|null):number {
    // they've added a user.  So we want to perhaps manage the game start to tip it towards starting soon.
    let newId = this.userProvider.addUser(ccr, wsConnection, 0, this.raceState);

    const user = this.userProvider.getUser(newId);
    if(user && this._lastRaceStateMode === CurrentRaceState.PostRace) {
      // we are already done this race.  Claim that this user finished now
      user.setFinishTime(tmNow);
      user.setPosition(this.raceState.getMap().getLength());
    }

    if(this._tmScheduledRaceStart < 0) {
      // we don't have a race start time yet.  Let's put it in the future about 30 seconds
      this._tmScheduledRaceStart = tmNow + 5000;
    }
    this._scheduleTick();
    return newId;
  }
  public scheduleRaceStartTime(tmWhen:number) {
    this._tmScheduledRaceStart = tmWhen;
  }
  public getLastRaceState():CurrentRaceState {
    return this._lastRaceStateMode;
  }
  public getRaceStartTime():number {
    return this._tmRaceStart;
  }
  public getRaceScheduledStartTime():number {
    return this._tmScheduledRaceStart;
  }
  public getUser(userId:number):ServerUser|undefined {
    return userIdToUserMap.get(userId);
  }
  private _tick() {
    StatsData.note("ServerGame::_tick() " + this.getGameId());
    if(this._stopped) {
      return;
    }
    StatsData.note("ServerGame::_tick() " + this.getGameId() +" - not stopped");
    const tmNow = new Date().getTime();

    let thisRaceState:CurrentRaceState|null = null;


    // update AI powers
    if(tmNow - this._tmLastAiUpdate > 250) {
      const allUsers = this.userProvider.getUsers(tmNow);
      
          
      let allHumansCoasting = allUsers.every((user) => (user.getUserType() & UserTypeFlags.Ai) || (user.getLastPower() <= 0));
      let humanCount = allUsers.filter((user) => !(user.getUserType() & UserTypeFlags.Ai)).length;
      const allAisShouldCoast = humanCount >= 2 && allHumansCoasting; // if every human has decided to not pedal, then lets have all the AIs stop too
      
      allUsers.forEach((user:UserInterface) => {
        if(user.getUserType() & UserTypeFlags.Ai) {
          const spread = 50;
          const pct = user.getHandicap() / DEFAULT_HANDICAP_POWER;
          let power = pct*user.getHandicap() + Math.random()*spread - spread/2;
  

          // let's see if this user has a brain...
          const aiBrain = this._aiBrains.get(user.getId());

          if(allAisShouldCoast) {
            power = 0;
          } else if(aiBrain) {
            if(aiBrain.isNN()) {
              const data = takeTrainingSnapshot(tmNow, user as User, this.raceState);
              if(data) {
                power = aiBrain.getPowerNN(user.getHandicap(), data);
              } else {
                power = user.getHandicap() * 0.9;
              }
            } else {
              const map = this.raceState.getMap();
              const dist = user.getDistance();
              power = aiBrain.getPower(tmNow / 1000.0, user.getHandicap(), dist, map.getLength(), map.getSlopeAtDistance(dist)*100);
            }
          }
          user.notifyPower(tmNow, Math.max(0, power));
        }
      })
      this._tmLastAiUpdate = tmNow;
    }

    if(tmNow < this._tmScheduledRaceStart) {
      // not ready for race start yet, so don't run the physics
      this._scheduleTick();
      thisRaceState = CurrentRaceState.PreRace;
      this._tmRaceStart = -1;
    } else {
      // we racin!
      if(this._tmRaceStart < 0) {
        this._tmRaceStart = tmNow; // record the very first timestamp that we applied physics
      }

      switch(this._lastRaceStateMode) {
        case CurrentRaceState.PreRace:
          // our last race state was prerace, but our tmNow is greater than the scheduled race start time.  So we're definitely racing now!
          thisRaceState = CurrentRaceState.Racing;
          console.log(`we're past the scheduled start time of ${this.raceState.getGameId()}, so we're starting`);
          this.raceState.tick(tmNow);
          break;
        case CurrentRaceState.Racing:
        {
          if(this.raceState.isAllHumansFinished(tmNow)) {
            const sSinceFinish = this.raceState.getSecondsSinceLastNonFinishedHuman(tmNow);
            if(this.raceState.isAllRacersFinished(tmNow) || sSinceFinish >= 30) {
              // ok, absolutely everyone is finished (or it's been 60s since the last human finished), so we _really_ don't need a physics update, and we're definitely post-race
              console.log("All racers finished (or its been 30sec since last human finisher), so we're stopping this race");
              this.stop();
              const permanentFinishUpdate = new S2CFinishUpdate(this.userProvider, this._tmRaceStart);
              try{fs.mkdirSync('../finish-data/');}catch(e){}
              
              fs.writeFileSync(`../finish-data/${S2CFinishUpdate.getPermanentKey(permanentFinishUpdate)}.json`, JSON.stringify(permanentFinishUpdate));

              thisRaceState = CurrentRaceState.PostRace;
              console.log(`all racers (human and AI) are done ${this.raceState.getGameId()}, so we're post-race now`);
            } else {
              // some AIs are still going, and some humans may return at some point.
              this.raceState.tick(tmNow);
              if(sSinceFinish >= 300) {
                thisRaceState = CurrentRaceState.PostRace;
                console.log("Been 5 minutes since we last saw an unfinished human on " + this.raceState.getGameId() + ", so we're going to post-race");
              } else {
                thisRaceState = CurrentRaceState.Racing;
              }
            }
          } else {
            // some humams are still racing
            this.raceState.tick(tmNow);
            thisRaceState = CurrentRaceState.Racing;
          }
          break;
        }
        case CurrentRaceState.PostRace:
        {
          thisRaceState = CurrentRaceState.PostRace;
          break;
        }
      }
      this._scheduleTick();
    }

    assert2(thisRaceState !== null, "We must set this every time");
    this._lastRaceStateMode = thisRaceState;
  }
  
  private _scheduleTick() {
    if(this._stopped) {
      // don't do anything!
    } else {
      this._timeout = setTimeout(() => this._tick(), 1000 / SERVER_PHYSICS_FRAME_RATE);
    }
  }
  private _stopped:boolean = false;
  private _timeout:any;
  private _name:string;
  private _gameId:string;
  private _tmRaceStart:number; // first timestamp that we applied physics
  private _tmScheduledRaceStart:number; // timestamp that we plan on starting the race
  private _lastRaceStateMode:CurrentRaceState = CurrentRaceState.PreRace; // a summary of the race mode we're currently running
  private _tmLastAiUpdate:number;
  raceState:RaceState;
  userProvider:ServerUserProvider;
  private _aiBrains:Map<number, AIBrain>;
}