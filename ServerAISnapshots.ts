import { LayersModel, Tensor, Tensor2D } from "@tensorflow/tfjs-node";
import { getAIStrengthBoostForDistance, RaceState } from "./RaceState";
import { RideMap } from "./RideMap";
//import { StatsData } from "./ServerGame";
import { DEFAULT_CDA, DEFAULT_CRR, DEFAULT_GRAVITY, DEFAULT_HANDICAP_POWER, DEFAULT_RHO, DEFAULT_RIDER_MASS, User, UserInterface, UserTypeFlags } from "./User";
import { assert2 } from "./Utils";
//import tf from '@tensorflow/tfjs-node';

function randRange(min:number, max:number):number {
  const span = max - min;
  return Math.floor(Math.random() * span + min);
}

export function buildModel(tf:any, nInput:number, nOutput:number) {
  // https://codelabs.developers.google.com/codelabs/tfjs-training-regression/index.html#3
  // and
  // https://codelabs.developers.google.com/codelabs/tfjs-training-regression/index.html#8
  const model = tf.sequential();
  model.add(tf.layers.dense({inputShape: [nInput], units: nInput}));
  model.add(tf.layers.gaussianNoise({stddev: 0.05}))
  model.add(tf.layers.dense({units: randRange(25,75), activation: 'sigmoid'}));
  model.add(tf.layers.gaussianNoise({stddev: 0.05}))
  model.add(tf.layers.dense({units: randRange(25,75), activation: 'sigmoid'}));
  model.add(tf.layers.dense({units: nOutput}));

  return model;
}

export function predictFromRawTrainingData(tf:any, model:LayersModel, norms:NormData, data:TrainingSnapshotV2):number {
  const preppedData = new TrainingDataPrepped(data, norms.killCols)._myData.map((dt) => dt.data);
  assert2(preppedData.length === norms.inputSpans.length, `Our prepped data had ${preppedData.length} but our trained model expected ${norms.inputSpans.length}`);
  const numbers = makeTensor(tf, [preppedData]);
  
  const normalizedInputs = normalizeData(numbers, norms.inputMin, norms.inputMax);
  const predictions = model.predict(normalizedInputs);
  const fixedPreds = unnormalizeData(predictions, norms.labelMin, norms.labelMax);

  let ret:number = fixedPreds.dataSync()[0];

  numbers.dispose();
  normalizedInputs.dispose();
  if(fixedPreds.dispose) {
    fixedPreds.dispose();
  }

  ret = Math.max(0, ret);
  return ret;
  //return 0;
}
export class NormData {
  inputMin:Tensor;
  inputMax:Tensor;
  labelMin:Tensor;
  labelMax:Tensor;
  inputSpans:Float32Array;
  labelSpans:Float32Array;
  killCols:number[];

  constructor(inputs:Tensor2D, labels:Tensor2D, killCols:number[]) {
    
    
    this.inputMin = inputs.min(0);
    this.inputMax = inputs.max(0);
    this.labelMin =labels.min(0);
    this.labelMax = labels.max(0);
    this.killCols = killCols;

    this.inputSpans = this.inputMax.sub(this.inputMin).dataSync() as Float32Array;
    this.labelSpans = this.labelMax.sub(this.labelMin).dataSync() as Float32Array;

    assert2(Array.isArray(killCols) && killCols.length >= 0 && killCols.length < this.inputSpans.length);
  }

  toJSON() {
    return {
      inputMin: this.inputMin.dataSync(),
      inputMax: this.inputMax.dataSync(),
      labelMin: this.labelMin.dataSync(),
      labelMax: this.labelMax.dataSync(),
      killCols: this.killCols,
    }
  }
}

interface TrainingSnapshot {
  tm:number;

  // inputs:
  distanceToFinish:number;
  distanceInRace:number;
  pctOfRaceComplete:number;

  metersLeftToClimb:number;
  metersLeftToClimbCurrentUphill:number;
  metersLeftToDescend:number;
  metersLeftToDescentCurrentDownhill:number;
  avgSlopeCurrentUphill:number;
  avgSlopeCurrentDownhill:number;


  last5MinPctFtp:number;
  last30SecPctFtp:number;

  gapToHumanAhead:number;
  gapToHumanBehind:number;
  closeRateHumanAhead:number;
  closeRateHumanBehind:number;
  gapToLeader:number;
  closeRateToLeader:number;

  gapToGroupAhead:number;
  gapToGroupBehind:number;
  closeRateGroupAhead:number;
  closeRateGroupBehind:number;

  rankInGroup:number;
  groupSize:number;
  ridersAheadOfGroup:number;


  // output:
  powerNextSecond:number;
}

export interface TrainingSnapshotV2 extends TrainingSnapshot {
  version:"2";

  speed:number;
  currentSlope:number;
  currentDraftPct:number;
  currentDrafteeCount:number;
  closestDrafteeFtpSecondsSavedPerKm:number; // the person hot on our ass, how much have they been saving?
  biggestLeechInGroupFtpSecondsSavedPerKm:number; // in our group, who has been saving the most?
  ftpSecondsSpentPerKm:number[]; // all the various metrics stuff from getHandicapSecondsUsed
  ftpSecondsSavedPerKm:number;

}

export interface DataWithName {
  name:string;
  data:number;
}

function bound(min:number, val:number, max:number):number {
  return Math.max(min, Math.min(val, max));
}

function getTerminalVelocity(pctOfFtp:number, slopeInPercent:number):number {
  
  let guessSpeed = 0.5;
  let maxAccelSpeed = guessSpeed;
  let minDecelSpeed = 0;
  while(true) {
    const dragRolling = -DEFAULT_CRR * DEFAULT_RIDER_MASS * DEFAULT_GRAVITY;
    const dragAero = DEFAULT_CDA * DEFAULT_RHO * 0.5 * guessSpeed * guessSpeed;

    const normalForce = DEFAULT_RIDER_MASS * DEFAULT_GRAVITY;
    const dragSlope = (slopeInPercent / 100) * normalForce;

    const outputPower = (DEFAULT_HANDICAP_POWER * pctOfFtp);
    const accelPower = outputPower / Math.max(guessSpeed, 0.5);

    const totalForce = accelPower - dragSlope - dragAero - dragRolling;

    if(Math.abs(totalForce) <= 0.1) {
      // found our equilibrium
      //console.log(`Terminal velocity for ${outputPower.toFixed(1)}W and slope ${slopeInPercent.toFixed(1)} is ${(guessSpeed*3.6).toFixed(0)}km/h`)
      return guessSpeed;
    } else if(totalForce < 0) {
      // we'd be decelerating at this speed
      minDecelSpeed = guessSpeed;
      guessSpeed = (minDecelSpeed + maxAccelSpeed) / 2;
    } else {
      maxAccelSpeed = guessSpeed;
      if(minDecelSpeed) {
        // we're narrowing down the bounds now, so we're doing a binary search
        guessSpeed = (minDecelSpeed + maxAccelSpeed) / 2;
      } else {
        // we're hunting for how fast we have to go before we start decelerating
        guessSpeed *= 2;
      }
      
    }
  }
}

export class TrainingDataPrepped {
  _myData:DataWithName[];
  constructor(snap:TrainingSnapshotV2, killCols:number[]) {
    // we need to pre-normalize a bunch of these, as well as filter out crap that doesn't matter
    let temp:any = {...snap};

    delete temp.tm; // this is not helpful
    delete temp.powerNextSecond; // this is label data
    delete temp.rankInGroup; // absolute ranks aren't that important, we will convert this into a percentage of the group size

    temp.raceTotalLength = temp.distanceInRace + temp.distanceToFinish;
    temp.pctOfRaceToFinish = 1 - snap.pctOfRaceComplete;
    delete temp.distanceInRace; // absolute meters aren't helpful when we're talking about a wide variety of possible lengths for a given player
    delete temp.distanceToFinish; // absolute meters aren't helpful when we're talking about a wide variety of possible lengths for a given player

    temp.negAvgSlopeCurrentDownhill = -temp.avgSlopeCurrentDownhill;
    temp.negAvgSlopeCurrentUphill = -temp.avgSlopeCurrentUphill;
    temp.currentSlope = -Math.abs(snap.avgSlopeCurrentDownhill) || Math.abs(snap.avgSlopeCurrentUphill);
    temp.instantSlope = snap.currentSlope;
    temp.heightDeltaInCurrentHill = Math.abs(snap.metersLeftToClimbCurrentUphill) || -Math.abs(snap.metersLeftToDescentCurrentDownhill);
    temp.heightDeltaRemaining = Math.abs(snap.metersLeftToClimb) || -Math.abs(snap.metersLeftToDescend);

    temp.terminalVelocityAtFtp = getTerminalVelocity(1.0, snap.currentSlope);
    temp.deltaToTerminalVelocity = snap.speed - temp.terminalVelocityAtFtp;

    if(snap.ridersAheadOfGroup <= 0) {
      // we're winning!
      temp.victoryMargin = snap.gapToGroupBehind;
      temp.victoryOrLossMargin = snap.gapToGroupBehind;
    } else {
      // not winning -> victory margin of zero
      temp.victoryMargin = 0;
      temp.victoryOrLossMargin = -Math.abs(snap.gapToGroupAhead);
    }

    delete temp.gapToHumanAhead;
    delete temp.gapToHumanBehind;
    delete temp.closeRateHumanAhead;
    delete temp.closeRateHumanBehind;
    
    // in particular, the "distance to finish", "distance in race" are going to be crap.
    // if Art does a 5km race and a 50km race in the same training set, then the 5km race's "distance" values will be 1/10th what they should be after normalization.
    const distancesPassed = [
      250,
      500,
      1000,
      1500,
      2500,
      3500,
      4500,
      5000,
      7500,
      10000,
      15000,
    ];
    
    distancesPassed.forEach((dist) => {
      temp[`distance-passed-${dist}`] = bound(0, snap.distanceInRace / dist, 1);
      temp[`distanceleft-passed-${dist}`] = bound(0, snap.distanceToFinish / dist, 1);
    });

    temp.aiRatingForDistanceCovered = getAIStrengthBoostForDistance(snap.distanceInRace);
    temp.aiRatingForMapLength = getAIStrengthBoostForDistance(temp.raceTotalLength);
    temp.aiRatingForDistanceLeft = getAIStrengthBoostForDistance(snap.distanceToFinish);
    
    temp.rankInGroup = snap.rankInGroup / snap.groupSize; // normalizing this so that it's not compared against someone that rode in a group of 30

    this._myData = [];
    let needHandleStuff = false;
    for(var key in temp) {
      if(typeof temp[key] === 'number') {
        this._myData.push({data:temp[key], name: key});
      } else if(Array.isArray(temp[key])) {
        
        switch(key) {
          case 'ftpSecondsSpentPerKm':
            /*const asNameValue = temp[key].map((val:number,index:number) => {
              return {
                name: key + '-' + index,
                data: val,
              }
            })
            this._myData.push(...asNameValue);*/
            break;
          default:
            needHandleStuff = true;
            console.log("gotta handle", key, " which had values ", temp[key]);
            break;
        }

      }
    }
    
    if(needHandleStuff) {
      debugger;
    }

    killCols.reverse().forEach((ixColToKill) => {
      this._myData.splice(ixColToKill, 1);
    });
  }
}

function getMetersLeftToClimb(currentDist:number, map:RideMap, dir:number) {
  let lastElev = dir*map.getElevationAtDistance(currentDist);

  let climbAmount = 0;
  for(var dist = currentDist; dist < map.getLength(); dist += map.getLength() / 100) {
    const elev = dir*map.getElevationAtDistance(dist);
    if(elev > lastElev) {
      climbAmount += elev - lastElev;
    }
    lastElev = elev;
  }

  return climbAmount;
}
function getMetersLeftToClimbCurrentHill(currentDist:number, map:RideMap, dir:number):{vertToGo:number, horzToGo:number} {
  let lastElev = dir*map.getElevationAtDistance(currentDist);

  let climbAmount = 0;
  const step = map.getLength() / 100;
  let dist = currentDist + step;
  for(; dist < map.getLength(); dist += step) {
    const elev = dir*map.getElevationAtDistance(dist);
    if(elev > lastElev) {
      climbAmount += elev - lastElev;
    } else {
      break;
    }
    lastElev = elev;
  }

  return {vertToGo:climbAmount, horzToGo:dist - step - currentDist};
}

function getGroup(ixMe:number, allUsersSorted:UserInterface[]):{group:UserInterface[], ixYou:number, ridersAheadOfGroup:number} {
  let group = [];
  let lastDistance = allUsersSorted[ixMe].getDistance();
  let ridersAheadOfGroup = 0;

  // check ahead of us
  lastDistance = allUsersSorted[ixMe].getDistance();
  for(var ixAhead = ixMe + 1; ixAhead < allUsersSorted.length; ixAhead++) {
    const user = allUsersSorted[ixAhead];
    const thisDist = user.getDistance();
    const delta = Math.abs(thisDist - lastDistance);
    if(delta < 10) {
      // still part of the group
      group.push(user);
      lastDistance = thisDist;
    } else {
      // this rider has broken away from the user's group
      ridersAheadOfGroup = allUsersSorted.length - ixAhead - 1;
      break;
    }
  }

  const ixYou = group.length; // since we know how many people are in the group ahead of you, then we know your rank in the group
  group.push(allUsersSorted[ixMe]); // you're in the group!

  // check behind us
  lastDistance = allUsersSorted[ixMe].getDistance();
  for(var ixBehind = ixMe - 1; ixBehind >= 0; ixBehind--) {
    const user = allUsersSorted[ixBehind];
    const thisDist = user.getDistance();
    const delta = Math.abs(thisDist - lastDistance);
    if(delta < 10) {
      // still part of the group
      group.push(user);
      lastDistance = thisDist;
    } else {
      // behind the group, we're done adding
      break;
    }
  }

  group.sort((a, b) => a.getDistance() < b.getDistance() ? -1 : 1);
  return {group, ixYou, ridersAheadOfGroup};
}

export function takeTrainingSnapshot(tmNow:number, user:User, raceState:RaceState):TrainingSnapshotV2|null {
  const ret:TrainingSnapshotV2 = {
    tm: new Date().getTime(),
    version: "2",
  } as any;

  const map:RideMap = raceState.getMap();
  
  if(user.getDistance() >= map.getLength() || user.isFinished()) {
    // they're done, so no snapshot to be done
    return null;
  }
  if(raceState.isAllRacersFinished(tmNow)) {
    return null;
  }
  if(user.isFinished()) {
    return null;
  }
  if(user.getDistance() <= 50) {
    return null;
  }
  
  const dist = user.getDistance();

  ret.speed = user.getSpeed();
  ret.currentSlope = user.getLastSlopeInWholePercent();
  ret.ftpSecondsSavedPerKm = user.getHandicapSecondsSaved() / dist;
  ret.ftpSecondsSpentPerKm = [];
  const spent = user.getHandicapSecondsUsed();
  for(var key in spent) {
    ret.ftpSecondsSpentPerKm.push(spent[key] / dist);
  }
  ret.currentDraftPct = user.getLastWattsSaved().pctOfMax;
  ret.currentDrafteeCount = user.getDrafteeCount(tmNow);

  const drafteeIds = user.getDrafteeIds(tmNow);
  let usersOrNulls:(UserInterface|null)[] = drafteeIds.map((id) => raceState.getUserProvider().getUser(id));
  let users:UserInterface[] = usersOrNulls.filter((u) => u) as UserInterface[];
  users.sort((a:UserInterface, b:UserInterface) => a.getDistance() > b.getDistance() ? -1 : 1);
  ret.closestDrafteeFtpSecondsSavedPerKm = (users && users.length > 0 && users[0]?.getHandicapSecondsSaved() || 0) / dist;



  ret.distanceToFinish = map.getLength() - user.getDistance();
  ret.distanceInRace = user.getDistance();
  ret.pctOfRaceComplete = user.getDistance() / map.getLength();

  const currentHillUp = getMetersLeftToClimbCurrentHill(user.getDistance(), map, 1);
  const currentHillDown = getMetersLeftToClimbCurrentHill(user.getDistance(), map, -1);

  ret.metersLeftToClimb = getMetersLeftToClimb(user.getDistance(), map, 1);
  ret.metersLeftToClimbCurrentUphill = currentHillUp.vertToGo
  ret.metersLeftToDescend = getMetersLeftToClimb(user.getDistance(), map, -1);
  ret.metersLeftToDescentCurrentDownhill = currentHillDown.vertToGo;

  ret.avgSlopeCurrentUphill = (currentHillUp.vertToGo / currentHillUp.horzToGo) || 0;
  ret.avgSlopeCurrentDownhill = (currentHillDown.vertToGo / currentHillDown.horzToGo) || 0;

  ret.last30SecPctFtp = user.getPowerAverageForLastNSeconds(tmNow, 30) / user.getHandicap();
  ret.last5MinPctFtp = user.getPowerAverageForLastNSeconds(tmNow, 300) / user.getHandicap();

  const allUsers = raceState.getUserProvider().getUsers(tmNow);
  allUsers.sort((a, b) => a.getDistance() < b.getDistance() ? -1 : 1);

  const ixMe = allUsers.findIndex((u) => u === user);
  assert2(ixMe >= 0); // we should always be able to find ourselves
  if(ixMe >= 0 && ixMe < allUsers.length - 1) {
    // finding group ahead
    const nextAhead = allUsers[ixMe + 1];
    if(nextAhead) {
      ret.gapToGroupAhead = nextAhead.getSecondsAgoToCross(tmNow, user.getDistance()) || 0;
      ret.closeRateGroupAhead = user.getSpeed() - nextAhead.getSpeed();
    } else {
      ret.gapToGroupAhead = 0;
      ret.closeRateGroupAhead = 0;
      assert2(false);
    }

    const nextHumanAhead = allUsers.slice(ixMe+1).find((u) => !(u.getUserType() & UserTypeFlags.Ai));
    if(nextHumanAhead) {
      ret.gapToHumanAhead = nextHumanAhead.getSecondsAgoToCross(tmNow, user.getDistance()) || 0;
      ret.closeRateHumanAhead = user.getSpeed() - nextHumanAhead.getSpeed();
    } else {
      ret.gapToHumanAhead = 0;
      ret.closeRateHumanAhead = 0;
    }
  } else {
    ret.gapToGroupAhead = 0;
    ret.gapToHumanAhead = 0;
    ret.closeRateGroupAhead = 0;
    ret.closeRateHumanAhead = 0;
  }
  
  if(ixMe >= 1) {
    // finding group behind
    const nextBehind = allUsers[ixMe - 1];
    if(nextBehind) {
      ret.gapToGroupBehind = user.getSecondsAgoToCross(tmNow, nextBehind.getDistance()) || 0;
      ret.closeRateGroupBehind = user.getSpeed() - nextBehind.getSpeed();
    } else {
      ret.gapToGroupBehind = 0;
      ret.closeRateGroupBehind = 0;
      assert2(false);
    }

    const nextHumanBehind = allUsers.slice(0, ixMe - 1).find((u) => !(u.getUserType() & UserTypeFlags.Ai));
    if(nextHumanBehind) {
      ret.gapToHumanBehind = user.getSecondsAgoToCross(tmNow, nextHumanBehind.getDistance()) || 0;
      ret.closeRateHumanBehind = nextHumanBehind.getSpeed() - user.getSpeed();
    } else {
      ret.gapToHumanBehind = 0;
      ret.closeRateHumanBehind = 0;
    }
  } else {
    ret.gapToGroupBehind = 0;
    ret.gapToHumanBehind = 0;
    ret.closeRateGroupBehind = 0;
    ret.closeRateHumanBehind = 0;
  }

  const group = getGroup(ixMe, allUsers);

  ret.biggestLeechInGroupFtpSecondsSavedPerKm = Math.max(0, ...group.group.filter((u) => u.getId() !== user.getId()).map((u) => u.getHandicapSecondsSaved() / dist));
  ret.groupSize = group.group.length;
  ret.rankInGroup = group.ixYou;
  ret.ridersAheadOfGroup = group.ridersAheadOfGroup;


  ret.powerNextSecond = -1; // this needs to get filled in on our next cycle

  return ret;
}
export function trainingSnapshotToAILabel(data:TrainingSnapshotV2|any, index:number, array:TrainingSnapshotV2[]):number[] {

  let sum = 0;
  let count = 0;
  const N = 5;

  let lastDistance = array[index].distanceInRace;
  for(var x = index; x < Math.min(array.length, index+N); x++) {
    if(array[x].distanceInRace < lastDistance) {
      // since the TrainingSnapshot array is ALL the races this person has participated in, if it goes backwards that means we're on a new race
      break;
    }
    sum += array[x].powerNextSecond;
    count++;
  }
  return [sum / count];
}
export function trainingSnapshotToAIInput(data:TrainingSnapshotV2|any, killCols:number[]):DataWithName[] {
  return new TrainingDataPrepped(data, killCols)._myData;
}

export enum BrainLocation {
  ForTraining,
  Deployed,
}

export function brainPath(brain:string, location:BrainLocation):string {
  switch(location) {
    case BrainLocation.Deployed:
      return `./deploy-brains/${brain}`;
    default:
    case BrainLocation.ForTraining:
      return `./brains/${brain}`;
  }
}


export function removeBoringColumns(data:DataWithName[][]):{allInputDatasAsNumbers:number[][], killCols:number[]} {
  const cols = data[0].length;

  let killCols:number[] = [];
  for(var ixCol = 0; ixCol < cols; ixCol++) {
    console.log("working on col ", ixCol);
    let colMax = Math.max(...data.map((row) => row[ixCol].data));
    let colMin = Math.min(...data.map((row) => row[ixCol].data));
    if(colMin === colMax) {
      console.error("Data column ", data[0][ixCol].name, " is bad");
      killCols.push(ixCol);
    }
  }

  const allInputDatasAsNumbers = data.map((row) => {
    let ret = [];
    let lastCol = -1;
    killCols.forEach((ixKillCol) => {
      ret.push(...row.slice(lastCol+1, ixKillCol).map((dt) => dt.data));
      lastCol = ixKillCol;
    })
    ret.push(...row.slice(lastCol+1, row.length).map((dt) => dt.data));

    ret.forEach((val) => {
      assert2(!isNaN(val) && val >= -10000);
    });
    return ret;
  });

  return {
    allInputDatasAsNumbers,
    killCols,
  }
}


export function testModel(tf:any, model:LayersModel, inputData:Tensor2D, labelTensor:Tensor2D, normData:NormData, checkDeep:boolean, names:DataWithName[][]):{score:number, data:number[][], labels:string[]} {
  // https://codelabs.developers.google.com/codelabs/tfjs-training-regression/index.html#6

  tf.engine().startScope();

  const normalizedInput = normalizeData(inputData, normData.inputMin, normData.inputMax);
  const normalizedLabel = normalizeData(labelTensor, normData.labelMin, normData.labelMax);

  const normalizedPredictions = model.predict(normalizedInput);
  
  const thisScore = getRSquared((normalizedPredictions as Tensor).dataSync(), (normalizedLabel as Tensor).dataSync());
  //const thisScore = tf.metrics.meanSquaredError(normalizedLabel, normalizedPredictions as any).dataSync()[0];

  
  let data:number[][] = [];
  let labels:string[] = [];
  if(checkDeep) {
    const normRightAnswer = normalizedLabel.dataSync();
    const normPredAnswer = (normalizedPredictions as Tensor2D).dataSync();

    const unnormRightAnswer = labelTensor.dataSync();
    const unnormInputs = inputData.dataSync();
    const unnormPredAnswer = unnormalizeData(normalizedPredictions, normData.labelMin, normData.labelMax).dataSync();

    const perRow = unnormInputs.length / unnormPredAnswer.length;

    labels.push("Right Answer");
    labels.push("Predicted Answer");
    labels.push("Norm Right Answer");
    labels.push("Norm Predicted Answer");
    labels.push(...names[0].map((data) => data.name));

    unnormRightAnswer.forEach((ans, index) => {
      let myRow:number[] = [];
      myRow.push(ans); // the correct answer
      myRow.push(unnormPredAnswer[index]); // the predicted answer
      myRow.push(normRightAnswer[index]);
      myRow.push(normPredAnswer[index]);

      myRow.push(...unnormInputs.slice(index*perRow, (index+1)*perRow));
      data.push(myRow);
    })
  }
  tf.engine().endScope();

  return {score: thisScore.rSquared, data, labels};
}

function shuffle(arrays:any[][]):any[][] {
  let currentIndex = arrays[0].length;


  // While there remain elements to shuffle...
  while (currentIndex != 0) {

    // Pick a remaining element...
    const randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;

    // And swap it with the current element.
    arrays.forEach((rg) => {
      [rg[currentIndex], rg[randomIndex]] = [
        rg[randomIndex], rg[currentIndex]];
    })
    
  }

  return arrays;
}

export function unnormalizeData(data:any, min:Tensor, max:Tensor) {
  const subMin = max.sub(min);
  const dataMul = data.mul(subMin);
  const dataMulAdd = dataMul.add(min);

  subMin.dispose();
  dataMul.dispose();
  return dataMulAdd;
}
export function normalizeData(data:Tensor2D, min:Tensor, max:Tensor) {
  const subMin = data.sub(min);
  const maxSubMin = max.sub(min);
  const subMinDiv = subMin.div(maxSubMin);

  subMin.dispose();
  maxSubMin.dispose();

  return subMinDiv;
}
export function makeTensor(tf:any, arr:number[][]):Tensor2D {
  return tf.tensor2d(arr, [arr.length, arr[0].length]);
}

function getRSquared(predict:Float32Array|number[]|Int32Array|Uint8Array, correct:Float32Array|number[]|Int32Array|Uint8Array):{meanValue:number,SStot:number,SSres:number,rSquared:number} {
  var yAxis = correct;
  var rPrediction = [];

  var meanValue = 0; // MEAN VALUE
  var SStot = 0; // THE TOTAL SUM OF THE SQUARES
  var SSres = 0; // RESIDUAL SUM OF SQUARES
  var rSquared = 0;

  // SUM ALL VALUES
  for (var n in yAxis) { meanValue += yAxis[n]; }

  // GET MEAN VALUE
  meanValue = (meanValue / yAxis.length);
  
  for (var n in yAxis) { 
      // CALCULATE THE SSTOTAL    
      SStot += Math.pow(yAxis[n] - meanValue, 2); 
      // REGRESSION PREDICTION
      rPrediction.push(predict[n]);
      // CALCULATE THE SSRES
      SSres += Math.pow(rPrediction[n] - yAxis[n], 2);
  }

  // R SQUARED
  rSquared = 1 - (SSres / SStot);

  return {
      meanValue: meanValue,
      SStot: SStot,
      SSres: SSres,
      rSquared: rSquared
  };
}

const bestIterationsToAchieveScore:any = {};

export async function doNNTrainWithSnapshots(tf:any, rootNameOfBot:string, datas:TrainingSnapshotV2[], writeResult:(name:string, contents:string)=>void, visCallbacks:any, fnCancelCallback:()=>boolean) {
  // take our training snapshots and convert them into our training inputs
  let inputDataPrepped = datas.map((data) => trainingSnapshotToAIInput(data, []));
  let allLabelsAsNumbers = datas.map(trainingSnapshotToAILabel);

  // now that we've done the mapping, which tends to depend on them being in correct order, let's shuffle.
  [inputDataPrepped, allLabelsAsNumbers] = shuffle([inputDataPrepped, allLabelsAsNumbers]);

  // remove all the columns that have no actual information in them
  const {killCols, allInputDatasAsNumbers} = removeBoringColumns(inputDataPrepped);

  // take our training snapshots and convert them into our training labels
  let model = buildModel(tf, allInputDatasAsNumbers[0].length, 1);

  // https://codelabs.developers.google.com/codelabs/tfjs-training-regression/index.html#4

  

  const inputTensor = makeTensor(tf, allInputDatasAsNumbers);
  const labelTensor = makeTensor(tf, allLabelsAsNumbers);

  const slicePoint = Math.floor(0.75*datas.length);
  const afterSlicePoint = datas.length - slicePoint;
  const inputTrainingTensor = inputTensor.slice(0, slicePoint);
  const labelTrainingTensor = labelTensor.slice(0, slicePoint);
  const inputEvalTensor = inputTensor.slice(slicePoint, afterSlicePoint);
  const labelEvalTensor = labelTensor.slice(slicePoint, afterSlicePoint);

  const normData:NormData = new NormData(inputTensor, labelTensor, []); // we put in no kill cols here, because we removed the boring columns already.  But we need to remember to store the killCols when we save norm.json

  const normalizedInputs = normalizeData(inputTrainingTensor, normData.inputMin, normData.inputMax);
  const normalizedLabels = normalizeData(labelTrainingTensor, normData.labelMin, normData.labelMax);


  
  // https://codelabs.developers.google.com/codelabs/tfjs-training-regression/index.html#5
  model.compile({
    optimizer: tf.train.adam(),
    loss: tf.losses.meanSquaredError,
    metrics: ['mse'],
  });

  const batchSize = labelTrainingTensor.size;
  const epochs = 300;

  let bestSoFar = -1000;
  let bestOnThisRunSoFar = -1000;
  let bestEmittedSoFar = -1000;

  let loops = 0;
  let rebuilds = 0;
  let trains = 0;
  let failsUntilRedo = 40;
  let trainsSinceLastBest = 0;
  while(true) {
    const fromTheStartEachTime = {
      initialEpoch: 0,
      batchSize,
      epochs:epochs,
      shuffle: true,
      verbose: 0,
      callbacks: visCallbacks,
    }
    const sequentially = {
      initialEpoch: loops * epochs,
      batchSize,
      epochs: (loops+1)*epochs,
      shuffle: true,
      verbose: 0,
      callbacks: visCallbacks,
    }

    let sequenceParam;
    const rnd = Math.random();

    const ixOurBestSoFar = Math.floor(bestOnThisRunSoFar * 1000);
    const howLongItTookTheBestToDoThat = bestIterationsToAchieveScore[ixOurBestSoFar];
    console.log(`Last time, it took ${howLongItTookTheBestToDoThat} iterations to hit ${bestOnThisRunSoFar}`);
    let limit;
    if(howLongItTookTheBestToDoThat === undefined) {
      // we've done the best ever!
      limit = failsUntilRedo;
    } else {
      // someone else has gotten this far, so our limit will be barely longer
      limit = howLongItTookTheBestToDoThat * 1.05;
    }

    if(trains > failsUntilRedo) {
      console.log("Total model rebuild");
      model.dispose();
      model = buildModel(tf, allInputDatasAsNumbers[0].length, 1);
      model.compile({
        optimizer: tf.train.adam(),
        loss: tf.losses.meanSquaredError,
        metrics: ['mse'],
      });
      sequenceParam = fromTheStartEachTime;

      rebuilds++;
      loops = 0;
      trains = 0;
      trainsSinceLastBest = 0;
      bestOnThisRunSoFar = -1000;

    } else if(rnd > 0.9) {
      sequenceParam = fromTheStartEachTime;
      loops = 0;
    } else {
      sequenceParam = sequentially;
    }

    await model.fit(normalizedInputs, normalizedLabels, sequenceParam);
    trains++;
    trainsSinceLastBest++;

    const emitModel = async () => {

      
      const brainName = `${rootNameOfBot}-${thisScore.score.toFixed(8)}.brain`;
      await model.save(`file:///braintrain/${brainName}`);

      {// put the norm.json so that we can figure out the norms that this brain was trained with
        normData.killCols = killCols;
        writeResult(`h:\\braintrain\\${brainName}\\norm.json`, JSON.stringify(normData.toJSON()));
        normData.killCols = [];
      }

      { // make the CSV
        const bigScore = testModel(tf, model, inputEvalTensor, labelEvalTensor, normData, true, inputDataPrepped);
        let lines:string[] = [];
        lines.push(bigScore.labels.join('\t'));

        const restOfLines:string[] = bigScore.data.map((dataLine) => {
          return dataLine.map(d => d.toFixed(8)).join('\t');
        });
        lines.push(...restOfLines);
        writeResult(`h:\\braintrain\\${brainName}\\check.txt`, lines.join('\n'));
      }
      
    }

    const thisScore = testModel(tf, model, inputEvalTensor, labelEvalTensor, normData, false, inputDataPrepped);
    const prefix = `${rebuilds}.${trains}: `;
    bestOnThisRunSoFar = Math.max(bestOnThisRunSoFar, thisScore.score);
    if(thisScore.score > bestSoFar && trains > 1) {

      const ixStart = Math.floor(bestOnThisRunSoFar*1000);
      const ixEnd = Math.floor(thisScore.score * 1000);
      for(var x = ixStart; x < ixEnd; x++) {
        if(bestIterationsToAchieveScore[''+x] === undefined) {
          // have never achieved such greatness!
          bestIterationsToAchieveScore[''+x] = trains;
        } else {
          bestIterationsToAchieveScore[''+x] = Math.min(trains, bestIterationsToAchieveScore[''+x]);
        }
        
      }


      console.log(prefix + "Metric of prediction = ", thisScore.score.toFixed(8), " best so far ", bestSoFar.toFixed(8));

      // future training cycles should get 25% as many tries as it took us to get here, since they've got to beat us
      failsUntilRedo = Math.max(trains * 1.25, failsUntilRedo);
      trainsSinceLastBest = 0;

      if(thisScore.score > bestEmittedSoFar + 0.005) {
        emitModel();
        console.log("Stored result @ ", thisScore.score);
        bestEmittedSoFar = thisScore.score;
      }

      bestSoFar = thisScore.score;
    } else {
      console.log(`${prefix} missed (${thisScore.score})`);
    }
    loops++;
    
    if(fnCancelCallback()) {
      emitModel();
      break;
    }
  }
}